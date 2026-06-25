import type { ApiResult } from '../../../utils/apiResult'

import { TexasError, isFatalTexasErrorCode } from 'texas-poker-core'

import prisma from '../../../models'
import { logger } from '../../../logger'
import { GameWsGateway } from './gameWsGateway'
import { gameRuntimeRegistry } from './runtimeRegistry'
import { HTTP_STATUS } from '../../../constants/httpStatus'
import { drainAndInterpretTexas } from './texasDomain/drainTexasDomainEvents'
import { getTexasEventContextForRoom } from './texasDomain/texasEventContext'
import { unregisterNextHandHooks } from '../../../gameRuntime/nextHandCountdown'
import { handleFatalTexasEngineError } from './texasDomain/handleFatalTexasEngineError'

type QuitTxResult =
  | { kind: 'noop' }
  | {
      kind: 'fail'
      status: number
      message: string
    }
  | {
      kind: 'done'
      restCount: number
      deletedRoom: boolean
      /**
       * true：`RoomMember` 已删，但该玩家本手在座离场，环上 `removeById`
       *       延至本手 `Texas.reset()` 之后（见 `pendingLeaveByUserId`）。
       * false：局间退出，本流程已同步 `removeById`。
       */
      deferTexasSeatRemoval: boolean
    }

type QuitTxInput = {
  roomId: number
  userId: number
  /** 本请求内是否会在删成员之后立即 `FoldDueToLeave`（此时事务阶段 `didFoldDueToLeave` 仍为 false） */
  willFoldImmediatelyAfterMemberDelete: boolean
  queuedLeaveDuringHand: boolean
  canBypassInHandFold: boolean
}

/**
 * 退出对局：
 * - **局间**（`between_hands`）：删 `RoomMember`、立刻 `room.removeById`、广播、断 /game。
 * - **`isQuitBlockedUntilBlindsPosted`**：`onLock`/首局注册起至领域事件 `BlindsPosted` 处理完前禁止退出。
 * - **`in_hand` 在座离场**：入 `pendingLeaveDuringHand`；若当前可 `FoldDueToLeave`，**先删 `RoomMember` 再弃牌+drain**，
 *   以便 `HandEnded` 内 `flushDeferredTexasSeatRemovals` 用 DB 成员集判断摘环，避免幽灵座。
 *   若尚不可弃牌则仅排队，由后续回合 `TurnOffered` 等路径弃牌后再摘环。
 * - **`starting_hand`**：不可退出。
 */
export class QuitGameUseCase {
  constructor(private readonly wsGateway: GameWsGateway) {}

  static readonly CONTEXT = {
    IN_HAND: 'in_hand',
    AFTER_GAME_END: 'after_game_end'
  } as const

  static readonly DEFAULT_SUCCESS_PAYLOAD = {
    quitContext: QuitGameUseCase.CONTEXT.AFTER_GAME_END
  } as const

  /** 删成员 + 可能软删房间；不含 Texas 环上 `removeById`。 */
  async #deleteQuittingRoomMemberTx(input: QuitTxInput): Promise<QuitTxResult> {
    const {
      roomId,
      userId,
      willFoldImmediatelyAfterMemberDelete,
      queuedLeaveDuringHand,
      canBypassInHandFold
    } = input

    return prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM \`Room\` WHERE id = ${roomId} FOR UPDATE`

      const latestRoom = await tx.room.findUnique({
        where: { id: roomId },
        select: {
          id: true,
          gameStatus: true,
          deletedAt: true
        }
      })

      if (!latestRoom || latestRoom.deletedAt) {
        return { kind: 'noop' }
      }

      if (
        latestRoom.gameStatus !== 'between_hands' &&
        latestRoom.gameStatus !== 'in_hand'
      ) {
        return {
          kind: 'fail',
          status: HTTP_STATUS.CONFLICT,
          message: '当前阶段不可退出对局'
        }
      }

      /**
       * `in_hand`：允许 `queueLeaveDuringHand`、观战/漂移绕过、或「将立刻 FoldDueToLeave」
       *（删成员在弃牌之前执行，故此处 `didFoldDueToLeave` 尚为 false）。
       */
      if (
        latestRoom.gameStatus === 'in_hand' &&
        !willFoldImmediatelyAfterMemberDelete &&
        !canBypassInHandFold &&
        !queuedLeaveDuringHand
      ) {
        return {
          kind: 'fail',
          status: HTTP_STATUS.CONFLICT,
          message: '对局状态异常：无法完成离场弃牌'
        }
      }

      const compoundKey = { roomId, userId }
      const member = await tx.roomMember.findUnique({
        where: { roomId_userId: compoundKey } // eslint-disable-line camelcase
      })
      if (!member) {
        return { kind: 'noop' }
      }

      const memberCount = await tx.roomMember.count({ where: { roomId } })

      await tx.roomMember.delete({
        where: { roomId_userId: compoundKey } // eslint-disable-line camelcase
      })

      const restCount = memberCount - 1
      let deletedRoom = false
      if (restCount === 0) {
        await tx.room.update({
          where: { id: roomId },
          data: { deletedAt: new Date(), activeOwnerId: null, activeCode: null }
        })
        deletedRoom = true
      }

      return {
        kind: 'done',
        restCount,
        deletedRoom,
        deferTexasSeatRemoval: queuedLeaveDuringHand
      }
    })
  }

  async execute(input: {
    userId: number
    roomId: number
  }): Promise<ApiResult<{ quitContext: 'in_hand' | 'after_game_end' }>> {
    const { userId, roomId } = input
    const roomKey = String(roomId)

    const pre = await prisma.room.findUnique({
      where: { id: roomId },
      select: { id: true, gameStatus: true, deletedAt: true }
    })
    if (!pre || pre.deletedAt) {
      this.wsGateway.disconnectUserGameSockets(roomId, userId)
      return { ok: true, data: QuitGameUseCase.DEFAULT_SUCCESS_PAYLOAD }
    }

    const memberPre = await prisma.roomMember.findUnique({
      where: { roomId_userId: { roomId, userId } },
      select: {
        userId: true,
        user: {
          select: {
            name: true,
            avatarKey: true
          }
        }
      }
    })
    if (!memberPre) {
      this.wsGateway.disconnectUserGameSockets(roomId, userId)
      return { ok: true, data: QuitGameUseCase.DEFAULT_SUCCESS_PAYLOAD }
    }

    const texasPre = gameRuntimeRegistry.getTexas(roomKey)
    const runtimeMissingPlayer = Boolean(texasPre && !texasPre.room.has(userId))
    if (runtimeMissingPlayer) {
      logger.warn(
        `[quitGame] runtime drift detected: user not found in texas room, roomId=${roomId}, userId=${userId}`
      )
    }

    if (pre.gameStatus === 'starting_hand') {
      return {
        ok: false,
        status: HTTP_STATUS.CONFLICT,
        message: '本手正在准备开局, 请在盲注公布后再退出对局'
      }
    }

    if (
      texasPre &&
      gameRuntimeRegistry.isQuitBlockedUntilBlindsPosted(roomKey)
    ) {
      return {
        ok: false,
        status: HTTP_STATUS.CONFLICT,
        message: '本手已从锁定至盲注完成前，请在盲注公布后再退出对局'
      }
    }

    const seatStatusPre = texasPre?.room.getPlayerSeatStatusById(userId) ?? null
    const leftWasOnSeat = seatStatusPre === 'on-set'
    const isInHandWatcherQuit =
      pre.gameStatus === 'in_hand' && seatStatusPre === 'hang'
    const isInHandOnSeatQuit =
      pre.gameStatus === 'in_hand' && seatStatusPre === 'on-set'
    const canBypassInHandFold = isInHandWatcherQuit || runtimeMissingPlayer

    let didFoldDueToLeave = false
    let queuedLeaveDuringHand = false
    if (isInHandOnSeatQuit && !runtimeMissingPlayer) {
      gameRuntimeRegistry.queueLeaveDuringHand(roomKey, userId)
      queuedLeaveDuringHand = true
    }

    const willFoldImmediatelyAfterMemberDelete =
      queuedLeaveDuringHand &&
      Boolean(texasPre && texasPre.canFoldDueToLeave(userId))

    if (
      pre.gameStatus === 'in_hand' &&
      !canBypassInHandFold &&
      !queuedLeaveDuringHand
    ) {
      return {
        ok: false,
        status: HTTP_STATUS.CONFLICT,
        message: '房间状态与对局引擎不一致，请稍后重试或联系管理员'
      }
    }

    const txRes = await this.#deleteQuittingRoomMemberTx({
      roomId,
      userId,
      willFoldImmediatelyAfterMemberDelete,
      queuedLeaveDuringHand,
      canBypassInHandFold
    })

    if (txRes.kind === 'fail') {
      gameRuntimeRegistry.cancelQueuedLeave(roomKey, userId)
      return {
        ok: false,
        status: txRes.status,
        message: txRes.message
      }
    }

    if (txRes.kind === 'noop') {
      gameRuntimeRegistry.cancelQueuedLeave(roomKey, userId)
      this.wsGateway.disconnectUserGameSockets(roomId, userId)
      return { ok: true, data: QuitGameUseCase.DEFAULT_SUCCESS_PAYLOAD }
    }

    if (willFoldImmediatelyAfterMemberDelete) {
      const texasForFold = gameRuntimeRegistry.getTexas(roomKey)
      if (!texasForFold?.canFoldDueToLeave(userId)) {
        logger.error(
          `[quitGame] post-delete fold aborted: canFoldDueToLeave false roomId=${roomId} userId=${userId}`
        )
        gameRuntimeRegistry.cancelQueuedLeave(roomKey, userId)
        return {
          ok: false,
          status: HTTP_STATUS.CONFLICT,
          message: '退出失败：当前无法完成离场弃牌'
        }
      }
      try {
        const preEvents = texasForFold.dispatchCommand({
          type: 'FoldDueToLeave',
          playerId: userId
        })
        await drainAndInterpretTexas(getTexasEventContextForRoom(roomKey), {
          preEvents
        })
        didFoldDueToLeave = true
      } catch (e: unknown) {
        if (e instanceof TexasError && isFatalTexasErrorCode(e.code)) {
          await handleFatalTexasEngineError({
            error: e,
            roomId,
            roomKey,
            getRuntime: () => gameRuntimeRegistry.getOrThrow(roomKey)
          })
        }
        gameRuntimeRegistry.cancelQueuedLeave(roomKey, userId)
        const message = e instanceof Error ? e.message : '退出失败'
        logger.error(
          `[quitGame] FoldDueToLeave after member delete failed roomId=${roomId} userId=${userId}`,
          e
        )
        return { ok: false, status: HTTP_STATUS.CONFLICT, message }
      }
    }

    if (!txRes.deferTexasSeatRemoval) {
      gameRuntimeRegistry.cancelQueuedLeave(roomKey, userId)
    }
    gameRuntimeRegistry.clearNextHandManualTopUpRequest(roomKey, userId)
    const texas = gameRuntimeRegistry.getTexas(roomKey)

    if (texas) {
      try {
        gameRuntimeRegistry.removePendingPostBigBlind(roomKey, userId)
        if (!txRes.deferTexasSeatRemoval && texas.room.has(userId)) {
          texas.removePlayerByIdAsSystem(userId)
        }
      } catch (e) {
        logger.error('[quitGame] texas room remove/setOwner failed', e)
      }

      if (txRes.deletedRoom) {
        try {
          unregisterNextHandHooks(roomId)
        } catch (e) {
          logger.error('[quitGame] unregisterNextHandHooks failed', e)
        }
        gameRuntimeRegistry.destroyRuntime(roomKey)
      }
    } else if (txRes.deletedRoom) {
      try {
        unregisterNextHandHooks(roomId)
      } catch (e) {
        logger.error('[quitGame] unregisterNextHandHooks (no texas) failed', e)
      }
    }

    if (leftWasOnSeat || didFoldDueToLeave) {
      this.wsGateway.notifyPlayerLeftGame(
        roomKey,
        {
          roomId,
          userId,
          name: memberPre.user.name || `玩家${userId}`,
          avatarKey: memberPre.user.avatarKey || 'cartoon/default'
        },
        { excludeUserId: userId }
      )
    }

    if (!txRes.deferTexasSeatRemoval) {
      this.wsGateway.notifyPlayerQuitGame(roomKey, {
        roomId,
        userId,
        reason: 'quit'
      })
    }

    if (txRes.deletedRoom) {
      this.wsGateway.broadcastRoomListRoomDeleted(roomId)
    } else {
      this.wsGateway.broadcastWaitingRoomMemberLeft(roomId, {
        userId,
        reason: 'quit'
      })
      this.wsGateway.broadcastRoomListMemberCountChanged({
        roomId,
        memberCount: txRes.restCount
      })
    }

    /**
     * 全房 `game-table-roster` 为名单权威：
     * - 局间退出：已摘环，名单不含离场者；
     * - 本手 defer：仍在 `seats` 且 `leavePending`，绝不应落入 `watchers`。
     */
    if (!txRes.deletedRoom && gameRuntimeRegistry.hasTexas(roomKey)) {
      await this.wsGateway.notifyGameTableRosterFromRuntime(roomKey, roomId)
    }

    this.wsGateway.disconnectUserGameSockets(roomId, userId)

    return {
      ok: true,
      data: {
        quitContext:
          txRes.deferTexasSeatRemoval || canBypassInHandFold
            ? QuitGameUseCase.CONTEXT.IN_HAND
            : QuitGameUseCase.CONTEXT.AFTER_GAME_END
      }
    }
  }
}
