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
  ownerId: number
  roomInfo: StartGameValidatedContext['roomInfo']
  members: StartGameValidatedContext['members']
  roomKey: string
  userIds: number[]
}

/** 等待 /game 连接后的只读快照，供决策与开局分支使用。 */
type EnteringSnapshot = {
  roomId: number
  ownerId: number
  roomInfo: StartGameValidatedContext['roomInfo']
  roomKey: string
  userIds: number[]
  connectedUserIds: number[]
  connectedMembers: StartGameValidatedContext['members']
  unconnectedUserIds: number[]
  runtimeOwnerId: number | null
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
      newOwnerId: number
      connectedUserIds: number[]
      kickedUserIds: number[]
    }
  | {
      kind: 'start_game'
      /** 开局使用的房主（原房主未连时已切换） */
      runtimeOwnerId: number
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
   * 根据「已连上 /game 的 userId」推导未连列表、在房成员子集与运行时房主。
   * 无副作用；房主未连时取已连成员第一位。
   *
   * 不变量：`members` 与 `userIds` 同源时，`runtimeOwnerId` 为假仅当 `connectedUserIds` 为空
   *（此时 `connectedMembers` 为空，与「无人连上」一致）。若 socket 侧出现不在 members 里的 id，则属数据异常。
   */
  #buildConnectionSnapshot(input: {
    ownerId: number
    members: StartGameValidatedContext['members']
    userIds: number[]
    connectedUserIds: number[]
  }) {
    const { ownerId, members, userIds, connectedUserIds } = input
    const connectedSet = new Set(connectedUserIds)
    const unconnectedUserIds = userIds.filter((id) => !connectedSet.has(id))
    const connectedMembers = members.filter((m) => connectedSet.has(m.userId))
    const runtimeOwnerId = connectedSet.has(ownerId)
      ? ownerId
      : connectedMembers[0]?.userId

    return {
      unconnectedUserIds,
      connectedMembers,
      runtimeOwnerId
    }
  }

  /** 房主变更时广播 waiting-room-owner-changed，相同 id 则跳过。 */
  #broadcastOwnerChangedIfNeeded(
    roomId: number,
    oldOwnerId: number,
    newOwnerId: number
  ) {
    if (oldOwnerId === newOwnerId) return
    this.wsGateway.broadcastWaitingRoomOwnerChanged(roomId, {
      oldOwnerId,
      newOwnerId
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
          activeOwnerId: null
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
    ownerId: number
    newOwnerId: number
    connectedUserIds: number[]
    kickedUserIds: number[]
  }) {
    const { roomId, ownerId, newOwnerId, connectedUserIds, kickedUserIds } =
      input

    await prisma.$transaction(async (tx) => {
      await tx.room.update({
        where: { id: roomId },
        data: {
          gameStatus: 'waiting',
          ownerId: newOwnerId,
          activeOwnerId: newOwnerId
        }
      })
      if (kickedUserIds.length > 0) {
        await tx.roomMember.deleteMany({
          where: { roomId, userId: { in: kickedUserIds } }
        })
      }
    })

    this.#broadcastOwnerChangedIfNeeded(roomId, ownerId, newOwnerId)
    this.#disconnectUsers(roomId, kickedUserIds)
    this.wsGateway.broadcastRoomListMemberCountChanged({
      roomId,
      memberCount: 1
    })
    this.wsGateway.notifyEnteringResolved({
      roomId,
      outcome: 'back_waiting_room',
      connectedUserIds,
      kickedUserIds,
      ownerId: newOwnerId
    })
    this.wsGateway.untrackEntering(roomId)
  }

  /**
   * 多人已连但有人未连：必要时把房主切到 runtimeOwner、删未连成员、断连并更新列表人数。
   */
  async #syncConnectedMembersBeforeStart(input: {
    roomId: number
    ownerId: number
    connectedUserIds: number[]
    unconnectedUserIds: number[]
    runtimeOwnerId: number
  }) {
    const {
      roomId,
      ownerId,
      connectedUserIds,
      unconnectedUserIds,
      runtimeOwnerId
    } = input
    if (unconnectedUserIds.length === 0) return

    await prisma.$transaction(async (tx) => {
      if (ownerId !== runtimeOwnerId) {
        await tx.room.update({
          where: { id: roomId },
          data: { ownerId: runtimeOwnerId, activeOwnerId: runtimeOwnerId }
        })
      }
      await tx.roomMember.deleteMany({
        where: { roomId, userId: { in: unconnectedUserIds } }
      })
    })

    this.#broadcastOwnerChangedIfNeeded(roomId, ownerId, runtimeOwnerId)
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
    const { roomId, ownerId, roomInfo, members, roomKey, userIds } = input
    try {
      await this.wsGateway.waitForAllGameConnections(roomKey, userIds)
    } catch (e) {
      logger.warn('[entring] wait for all game connections timeout', e)
    }

    const connectedUserIds = this.wsGateway
      .getConnectedGameRoomUserIds(roomKey)
      .filter((id) => userIds.includes(id))
    const { unconnectedUserIds, connectedMembers, runtimeOwnerId } =
      this.#buildConnectionSnapshot({
        ownerId,
        members,
        userIds,
        connectedUserIds
      })

    return {
      roomId,
      ownerId,
      roomInfo,
      roomKey,
      userIds,
      connectedUserIds,
      connectedMembers,
      unconnectedUserIds,
      runtimeOwnerId: runtimeOwnerId ?? null
    }
  }

  /**
   * 根据连接人数与运行时房主生成 EnteringPlan；纯函数，不写库不发 WS。
   * 若连接集合与 members 快照不一致（例如 socket userId 不在 members 中），按异常收敛为 destroy_room。
   */
  #decideEnteringOutcome(snapshot: EnteringSnapshot): EnteringPlan {
    const {
      roomId,
      connectedUserIds,
      userIds,
      runtimeOwnerId,
      connectedMembers
    } = snapshot

    if (connectedUserIds.length === 0) {
      return { kind: 'destroy_room', expectedUserIds: userIds }
    }

    if (
      runtimeOwnerId == null ||
      connectedMembers.length !== connectedUserIds.length
    ) {
      logger.warn(
        '[entering] connection-member snapshot mismatch, destroy room',
        {
          roomId,
          connectedUserIds,
          connectedMembersCount: connectedMembers.length,
          runtimeOwnerId
        }
      )
      return { kind: 'destroy_room', expectedUserIds: userIds }
    }

    if (connectedUserIds.length === 1) {
      const [newOwnerId] = connectedUserIds
      return {
        kind: 'back_waiting_room',
        newOwnerId,
        connectedUserIds,
        kickedUserIds: userIds.filter((id) => id !== newOwnerId)
      }
    }

    return {
      kind: 'start_game',
      runtimeOwnerId,
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
    const { roomId, ownerId, roomInfo, roomKey, connectedMembers } = snapshot
    const { runtimeOwnerId, connectedUserIds, unconnectedUserIds } = plan

    await this.#syncConnectedMembersBeforeStart({
      roomId,
      ownerId,
      connectedUserIds,
      unconnectedUserIds,
      runtimeOwnerId
    })

    const runtimeOwner = connectedMembers.find(
      (m) => m.userId === runtimeOwnerId
    )!
    const runtimeRoomInfo = {
      ...roomInfo,
      owner: runtimeOwner.user
    }

    this.wsGateway.untrackEntering(roomId)

    const texas = createTexasAndSeatPlayers({
      roomInfo: runtimeRoomInfo,
      members: connectedMembers,
      ownerId: runtimeOwnerId
    })
    /** 所有玩家加载完后, 等待3s再通知玩家进入游戏 */
    await this.#delay(3000)
    const matchInfo = await createInitialMatchAndNotifyEntered({
      roomId,
      userIds: connectedUserIds,
      roomInfo: runtimeRoomInfo,
      wsGateway: this.wsGateway
    })
    const currentMatchId = matchInfo.id

    const rollbackManager = createMatchRollbackManager({
      texas,
      roomId,
      roomKey,
      runtimeRegistry: gameRuntimeRegistry,
      wsGateway: this.wsGateway
    })
    rollbackManager.snapshotPlayersAtHandStart(currentMatchId)
    gameRuntimeRegistry.register({
      roomId,
      roomKey,
      roomInfo: runtimeRoomInfo,
      texas,
      currentMatchId,
      matchStartedAt: Date.now(),
      rollbackManager,
      pendingTexasSeatRemovalUserIds: new Set(),
      quitBlockedUntilBlindsPosted: false
    })

    const { drainTexasDomainEvents } = bindTexasLifecycleEvents({
      texas,
      roomId,
      roomKey,
      roomInfo: runtimeRoomInfo,
      runtimeRegistry: gameRuntimeRegistry,
      wsGateway: this.wsGateway
    })

    const rtForSnapshot = gameRuntimeRegistry.getOrThrow(roomKey)
    if (rtForSnapshot.currentMatchId == null) {
      throw new Error(
        `[start game] snapshotPlayersAtHandStart: missing currentMatchId roomKey=${roomKey}`
      )
    }

    try {
      // TODO: 进入游戏时或许需要一个过渡, 避免页面空白, 先暂时留2秒
      // 进入游戏2秒后开始分配角色
      await this.#delay(
        gameRuntimeConfig.getStartGameBeforeAssignRolesDelayMs()
      )
      gameRuntimeRegistry.setQuitBlockedUntilBlindsPosted(roomKey, true)
      texas.setPlayerRoles()
      await transitionRoomGameStatus(roomId, 'starting_hand')

      await drainTexasDomainEvents()
      // 角色分配完成后, 等待2秒再发牌
      await this.#delay(gameRuntimeConfig.getNextHandDealAfterEndMs())
      texas.dealCards()
      await drainTexasDomainEvents()
      rtForSnapshot.rollbackManager.snapshotPlayersAtHandStart(
        rtForSnapshot.currentMatchId
      )

      // 发牌3秒后再开始游戏
      await this.#delay(gameRuntimeConfig.getNextHandStartAfterDealMs())
      texas.start()
      await drainTexasDomainEvents()
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
  async requestStart(roomId: number, ownerId: number) {
    const validated = await validateStartGameRequest(roomId, ownerId)
    if (!validated.ok) return validated

    const { members } = validated.data
    const userIds = members.map((m) => m.userId)
    await transitionRoomGameStatus(roomId, 'entering')
    await markRoomEnteringAndNotify(roomId, userIds, this.wsGateway)

    return {
      ok: true as const,
      data: {
        roomId,
        ownerId,
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
            ownerId: snapshot.ownerId,
            newOwnerId: plan.newOwnerId,
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
      await roomModel.update({
        where: { id: roomId },
        data: { gameStatus: 'waiting' }
      })
      logger.error('[entring] start game flow failed', e)
    }
  }
}
