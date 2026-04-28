import type { StartGameValidatedContext } from './types'

import { TexasError, isFatalTexasErrorCode } from 'texas-poker-core'

import { logger } from '../../../logger'
import { GameWsGateway } from './gameWsGateway'
import { gameRuntimeRegistry } from './runtimeRegistry'
import { createMatchRollbackManager } from './rollback'
import { bindTexasLifecycleEvents } from './eventBinder'
import { transitionRoomGameStatus } from './stateMachine'
import prisma, { room as roomModel } from '../../../models'
import { gameRuntimeConfig } from '../../../utils/gameRuntimeConfig'
import {
  validateStartGameRequest,
  markRoomEnteringAndNotify
} from './validator'
import { handleFatalTexasEngineError } from './texasDomain/handleFatalTexasEngineError'
import {
  createTexasAndSeatPlayers,
  createInitialMatchAndNotifyEntered
} from './runtime'

/** HTTP 已校验通过后，后台开局流程的入参（含房间快照与预期成员）。 */
type StartFlowInput = {
  roomId: number
  /** waiting-room 房主（仅用于 entering 阶段治理） */
  lobbyOwnerId: number
  roomInfo: StartGameValidatedContext['roomInfo']
  members: StartGameValidatedContext['members']
  roomKey: string
  userIds: number[]
}

/** 等待 /game 连接后的只读快照，供决策与开局分支使用。 */
type EnteringSnapshot = {
  roomId: number
  /** waiting-room 房主（仅用于 entering 阶段治理） */
  lobbyOwnerId: number
  roomInfo: StartGameValidatedContext['roomInfo']
  roomKey: string
  userIds: number[]
  connectedUserIds: number[]
  connectedMembers: StartGameValidatedContext['members']
  unconnectedUserIds: number[]
  /** 进入 in-game 前的引擎引导用户（不等价于 waiting-room owner） */
  runtimeStarterUserId: number | null
}

/** 纯决策结果：销毁房间 / 回退等待房 / 继续开局，载荷与 WS 推送语义对齐。 */
type EnteringPlan =
  | {
      kind: 'destroy_room'
      /** 开局前预期在房的全部用户（无人连上 / 全员踢出语义） */
      expectedUserIds: number[]
    }
  | {
      kind: 'back_waiting_room'
      /** 唯一在线玩家，兼任新房主 */
      newLobbyOwnerId: number
      connectedUserIds: number[]
      kickedUserIds: number[]
    }
  | {
      kind: 'start_game'
      /** 开局使用的引擎引导用户（原房主未连时可切换） */
      runtimeStarterUserId: number
      connectedUserIds: number[]
      unconnectedUserIds: number[]
    }

/**
 * 统一入口：开始游戏用例，路由层只调用该类。
 */
export class StartGameUseCase {
  constructor(private readonly wsGateway = new GameWsGateway()) {}

  /** 开局流程中的固定节拍延迟（与引擎发牌节奏一致）。 */
  async #delay(ms: number) {
    await new Promise((r) => setTimeout(r, ms))
  }

  /**
   * 根据「已连上 /game 的 userId」推导未连列表、在房成员子集与运行时引擎引导用户。
   * 无副作用；waiting-room 房主未连时取已连成员第一位。
   *
   * 不变量：`members` 与 `userIds` 同源时，`runtimeStarterUserId` 为假仅当 `connectedUserIds` 为空
   *（此时 `connectedMembers` 为空，与「无人连上」一致）。若 socket 侧出现不在 members 里的 id，则属数据异常。
   */
  #buildConnectionSnapshot(input: {
    lobbyOwnerId: number
    members: StartGameValidatedContext['members']
    userIds: number[]
    connectedUserIds: number[]
  }) {
    const { lobbyOwnerId, members, userIds, connectedUserIds } = input
    const connectedSet = new Set(connectedUserIds)
    const unconnectedUserIds = userIds.filter((id) => !connectedSet.has(id))
    const connectedMembers = members.filter((m) => connectedSet.has(m.userId))
    const runtimeStarterUserId = connectedSet.has(lobbyOwnerId)
      ? lobbyOwnerId
      : connectedMembers[0]?.userId

    return {
      unconnectedUserIds,
      connectedMembers,
      runtimeStarterUserId
    }
  }

  /** waiting-room 房主变更时广播 waiting-room-owner-changed，相同 id 则跳过。 */
  #broadcastLobbyOwnerChangedIfNeeded(
    roomId: number,
    oldLobbyOwnerId: number,
    newLobbyOwnerId: number
  ) {
    if (oldLobbyOwnerId === newLobbyOwnerId) return
    this.wsGateway.broadcastWaitingRoomOwnerChanged(roomId, {
      oldOwnerId: oldLobbyOwnerId,
      newOwnerId: newLobbyOwnerId
    })
  }

  /** 断开指定用户在等待房与游戏房命名空间下与该 room 相关的 socket。 */
  #disconnectUsers(roomId: number, userIds: number[]) {
    for (const userId of userIds) {
      this.wsGateway.disconnectUserRoomSockets(roomId, userId)
    }
  }

  /**
   * 全员未连 /game：软删房间、清空成员、断连、推送 game-entering-resolved + 房间列表删除。
   */
  async #handleDestroyRoom(input: {
    roomId: number
    expectedUserIds: number[]
  }) {
    const { roomId, expectedUserIds: userIds } = input
    await prisma.$transaction(async (tx) => {
      await tx.room.update({
        where: { id: roomId },
        data: {
          gameStatus: 'waiting',
          deletedAt: new Date(),
          activeOwnerId: null,
          activeCode: null
        }
      })
      await tx.roomMember.deleteMany({ where: { roomId } })
    })

    this.#disconnectUsers(roomId, userIds)
    this.wsGateway.notifyEnteringResolved({
      roomId,
      outcome: 'destroy_room',
      connectedUserIds: [],
      kickedUserIds: userIds,
      ownerId: null
    })
    this.wsGateway.broadcastRoomListRoomDeleted(roomId)
    this.wsGateway.untrackEntering(roomId)
  }

  /**
   * 仅一人连上：设为房主、删其余成员、断连被踢用户、推送回退等待房与 member 数。
   */
  async #handleBackWaitingRoom(input: {
    roomId: number
    lobbyOwnerId: number
    isPrivate: boolean
    newLobbyOwnerId: number
    connectedUserIds: number[]
    kickedUserIds: number[]
  }) {
    const {
      roomId,
      lobbyOwnerId,
      isPrivate,
      newLobbyOwnerId,
      connectedUserIds,
      kickedUserIds
    } = input

    await prisma.$transaction(async (tx) => {
      await tx.room.update({
        where: { id: roomId },
        data: {
          gameStatus: 'waiting',
          ownerId: newLobbyOwnerId,
          activeOwnerId: newLobbyOwnerId
        }
      })
      if (kickedUserIds.length > 0) {
        await tx.roomMember.deleteMany({
          where: { roomId, userId: { in: kickedUserIds } }
        })
      }
    })

    this.#broadcastLobbyOwnerChangedIfNeeded(
      roomId,
      lobbyOwnerId,
      newLobbyOwnerId
    )
    this.#disconnectUsers(roomId, kickedUserIds)
    if (!isPrivate) {
      this.wsGateway.broadcastRoomListPlaySessionChanged({
        roomId,
        playSession: 'lobby'
      })
    }
    this.wsGateway.broadcastRoomListMemberCountChanged({
      roomId,
      memberCount: 1
    })
    this.wsGateway.notifyEnteringResolved({
      roomId,
      outcome: 'back_waiting_room',
      connectedUserIds,
      kickedUserIds,
      ownerId: newLobbyOwnerId
    })
    this.wsGateway.untrackEntering(roomId)
  }

  /**
   * 多人已连但有人未连：必要时把 waiting-room 房主切到 runtimeStarter、删未连成员、断连并更新列表人数。
   */
  async #syncConnectedMembersBeforeStart(input: {
    roomId: number
    lobbyOwnerId: number
    connectedUserIds: number[]
    unconnectedUserIds: number[]
    runtimeStarterUserId: number
  }) {
    const {
      roomId,
      lobbyOwnerId,
      connectedUserIds,
      unconnectedUserIds,
      runtimeStarterUserId
    } = input
    if (unconnectedUserIds.length === 0) return

    await prisma.$transaction(async (tx) => {
      if (lobbyOwnerId !== runtimeStarterUserId) {
        await tx.room.update({
          where: { id: roomId },
          data: {
            ownerId: runtimeStarterUserId,
            activeOwnerId: runtimeStarterUserId
          }
        })
      }
      await tx.roomMember.deleteMany({
        where: { roomId, userId: { in: unconnectedUserIds } }
      })
    })

    this.#broadcastLobbyOwnerChangedIfNeeded(
      roomId,
      lobbyOwnerId,
      runtimeStarterUserId
    )
    this.#disconnectUsers(roomId, unconnectedUserIds)
    this.wsGateway.broadcastRoomListMemberCountChanged({
      roomId,
      memberCount: connectedUserIds.length
    })
  }

  /**
   * 等待全员 /game 连接（超时仅打日志），再拉当前连接列表并组装 EnteringSnapshot。
   */
  async #collectConnectionSnapshot(
    input: StartFlowInput
  ): Promise<EnteringSnapshot> {
    const { roomId, lobbyOwnerId, roomInfo, members, roomKey, userIds } = input
    try {
      await this.wsGateway.waitForAllGameConnections(roomKey, userIds)
    } catch (e) {
      logger.warn('[entring] wait for all game connections timeout', e)
    }

    const connectedUserIds = this.wsGateway
      .getConnectedGameRoomUserIds(roomKey)
      .filter((id) => userIds.includes(id))
    const { unconnectedUserIds, connectedMembers, runtimeStarterUserId } =
      this.#buildConnectionSnapshot({
        lobbyOwnerId,
        members,
        userIds,
        connectedUserIds
      })

    return {
      roomId,
      lobbyOwnerId,
      roomInfo,
      roomKey,
      userIds,
      connectedUserIds,
      connectedMembers,
      unconnectedUserIds,
      runtimeStarterUserId: runtimeStarterUserId ?? null
    }
  }

  /**
   * 根据连接人数与运行时引擎引导用户生成 EnteringPlan；纯函数，不写库不发 WS。
   * 若连接集合与 members 快照不一致（例如 socket userId 不在 members 中），按异常收敛为 destroy_room。
   */
  #decideEnteringOutcome(snapshot: EnteringSnapshot): EnteringPlan {
    const {
      roomId,
      connectedUserIds,
      userIds,
      runtimeStarterUserId,
      connectedMembers
    } = snapshot

    if (connectedUserIds.length === 0) {
      return { kind: 'destroy_room', expectedUserIds: userIds }
    }

    if (
      runtimeStarterUserId == null ||
      connectedMembers.length !== connectedUserIds.length
    ) {
      logger.warn(
        '[entering] connection-member snapshot mismatch, destroy room',
        {
          roomId,
          connectedUserIds,
          connectedMembersCount: connectedMembers.length,
          runtimeStarterUserId
        }
      )
      return { kind: 'destroy_room', expectedUserIds: userIds }
    }

    if (connectedUserIds.length === 1) {
      const [newOwnerId] = connectedUserIds
      return {
        kind: 'back_waiting_room',
        newLobbyOwnerId: newOwnerId,
        connectedUserIds,
        kickedUserIds: userIds.filter((id) => id !== newOwnerId)
      }
    }

    return {
      kind: 'start_game',
      runtimeStarterUserId,
      connectedUserIds,
      unconnectedUserIds: snapshot.unconnectedUserIds
    }
  }

  /**
   * 足够人数已连：同步 DB 与未连用户、注册 Texas 运行时、发牌开局并将房间标为 in_hand。
   */
  async #handleStartGame(
    plan: Extract<EnteringPlan, { kind: 'start_game' }>,
    snapshot: EnteringSnapshot
  ) {
    const { roomId, lobbyOwnerId, roomInfo, roomKey, connectedMembers } =
      snapshot
    const { runtimeStarterUserId, connectedUserIds, unconnectedUserIds } = plan

    await this.#syncConnectedMembersBeforeStart({
      roomId,
      lobbyOwnerId,
      connectedUserIds,
      unconnectedUserIds,
      runtimeStarterUserId
    })

    const runtimeStarterMember = connectedMembers.find(
      (m) => m.userId === runtimeStarterUserId
    )!
    const runtimeRoomInfo = {
      ...roomInfo,
      owner: runtimeStarterMember.user
    }

    this.wsGateway.untrackEntering(roomId)

    const texas = createTexasAndSeatPlayers({
      roomInfo: runtimeRoomInfo,
      members: connectedMembers,
      starterUserId: runtimeStarterUserId
    })
    /** 所有玩家加载完后, 等待2s再通知玩家进入游戏 */
    await this.#delay(2000)
    const matchInfo = await createInitialMatchAndNotifyEntered({
      roomId,
      userIds: connectedUserIds,
      roomInfo: runtimeRoomInfo,
      wsGateway: this.wsGateway
    })
    const currentMatchId = matchInfo.id

    const rollbackManager = createMatchRollbackManager({
      roomId,
      roomKey,
      runtimeRegistry: gameRuntimeRegistry,
      wsGateway: this.wsGateway
    })
    gameRuntimeRegistry.register({
      roomId,
      roomKey,
      roomInfo: runtimeRoomInfo,
      texas,
      currentMatchId,
      matchStartedAt: Date.now(),
      rollbackManager,
      pendingLeaveByUserId: new Set(),
      pendingPostBigBlindUserIds: new Set(),
      offlineUserIds: new Set(),
      offlineHandCountByUserId: new Map(),
      /** 与 `eventBinder` 的 `onLock` 一致：首局从注册起至领域事件 `BlindsPosted` 处理完前禁止 FoldDueToLeave */
      quitBlockedUntilBlindsPosted: true
    })

    const { drainTexasDomainEvents } = bindTexasLifecycleEvents({
      texas,
      roomId,
      roomKey,
      roomInfo: runtimeRoomInfo,
      runtimeRegistry: gameRuntimeRegistry,
      wsGateway: this.wsGateway
    })

    const runtime = gameRuntimeRegistry.getOrThrow(roomKey)
    if (runtime.currentMatchId == null) {
      throw new Error(`[start game] missing currentMatchId roomKey=${roomKey}`)
    }

    try {
      // TODO: 进入游戏时或许需要一个过渡, 避免页面空白, 先暂时留2秒
      // 进入游戏2秒后开始分配角色
      await this.#delay(
        gameRuntimeConfig.getStartGameBeforeAssignRolesDelayMs()
      )
      const roleEvents = texas.setPlayerRoles()
      await transitionRoomGameStatus(roomId, 'starting_hand')

      await drainTexasDomainEvents(roleEvents)
      // 角色分配完成后, 等待2秒再发牌
      await this.#delay(gameRuntimeConfig.getNextHandDealAfterEndMs())
      const dealEvents = texas.dealCards()
      await drainTexasDomainEvents(dealEvents)

      // 发牌3秒后再开始游戏
      await this.#delay(gameRuntimeConfig.getNextHandStartAfterDealMs())
      const startEvents = texas.start()
      await drainTexasDomainEvents(startEvents)
      await transitionRoomGameStatus(roomId, 'in_hand')
    } catch (e: unknown) {
      if (e instanceof TexasError && isFatalTexasErrorCode(e.code)) {
        await handleFatalTexasEngineError({
          error: e,
          roomId,
          roomKey,
          getRuntime: () => gameRuntimeRegistry.getOrThrow(roomKey)
        })
        return
      }
      throw e
    }
  }

  /** 校验 + 切 entering + 推送 game-entering，返回供后台 #runStartFlow 使用的数据。 */
  async requestStart(roomId: number, lobbyOwnerId: number) {
    const validated = await validateStartGameRequest(roomId, lobbyOwnerId)
    if (!validated.ok) return validated

    const { members } = validated.data
    const userIds = members.map((m) => m.userId)
    await transitionRoomGameStatus(roomId, 'entering')
    await markRoomEnteringAndNotify(roomId, userIds, this.wsGateway)

    return {
      ok: true as const,
      data: {
        roomId,
        lobbyOwnerId,
        roomInfo: validated.data.roomInfo,
        members,
        roomKey: String(roomId),
        userIds
      }
    }
  }

  /** 非阻塞启动开局后台任务（错误仅在日志与房间状态回滚中体现）。 */
  runStartFlowInBackground(input: StartFlowInput) {
    void this.#runStartFlow(input)
  }

  /**
   * 开局主流程：采集快照 → 决策 → 分支处理；异常时销毁运行时、untrack、房间回 waiting。
   */
  async #runStartFlow(input: StartFlowInput) {
    const { roomId, roomKey } = input

    try {
      const snapshot = await this.#collectConnectionSnapshot(input)
      const plan = this.#decideEnteringOutcome(snapshot)

      switch (plan.kind) {
        case 'destroy_room':
          await this.#handleDestroyRoom({
            roomId: snapshot.roomId,
            expectedUserIds: plan.expectedUserIds
          })
          return
        case 'back_waiting_room':
          await this.#handleBackWaitingRoom({
            roomId: snapshot.roomId,
            lobbyOwnerId: snapshot.lobbyOwnerId,
            isPrivate: snapshot.roomInfo.isPrivate,
            newLobbyOwnerId: plan.newLobbyOwnerId,
            connectedUserIds: plan.connectedUserIds,
            kickedUserIds: plan.kickedUserIds
          })
          return
        case 'start_game':
          await this.#handleStartGame(plan, snapshot)
          return
      }
    } catch (e: unknown) {
      gameRuntimeRegistry.destroyRuntime(roomKey)
      this.wsGateway.untrackEntering(roomId)
      try {
        await transitionRoomGameStatus(roomId, 'waiting')
      } catch {
        await roomModel.update({
          where: { id: roomId },
          data: { gameStatus: 'waiting' }
        })
      }
      logger.error('[entring] start game flow failed', e)
    }
  }
}
