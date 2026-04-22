import type { ApiVoidResult } from '../../../utils/apiResult'

import prisma from '../../../models'
import { logger } from '../../../logger'
import { GameWsGateway } from './gameWsGateway'
import { gameRuntimeRegistry } from './runtimeRegistry'
import { HTTP_STATUS } from '../../../constants/httpStatus'
import {
  cancelNextHandCountdown,
  unregisterNextHandHooks
} from '../../../gameRuntime/nextHandCountdown'

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
      newOwnerId: number | null
      /**
       * true：`RoomMember` 已删，环上 `removeById` 延至本手 `Texas.reset()` 之后（见 `pendingLeaveByUserId`）。
       * false：局间退出，本流程已同步 `removeById`。
       */
      deferTexasSeatRemoval: boolean
    }

/**
 * 退出对局：
 * - **局间**（`between_hands`）：删 `RoomMember`、立刻 `room.removeById`、广播、断 /game。
 * - **`isQuitBlockedUntilBlindsPosted`**：`onLock`/首局注册起至领域事件 `BlindsPosted` 处理完前禁止退出（与 Core 非 `in_hand` 时 `canFoldDueToLeave` 恒为假无关）。
 * - **进行中**（`in_hand`）：业务层登记离场队列；到该玩家 `TurnOffered` 时再自动 `FoldDueToLeave`，
 *   环上摘座延到本手 `reset` 后。
 * - **`starting_hand`**：不可退出（与上条重叠时仍保留，防状态机与运行时标志短暂不一致）。
 */
export class QuitGameUseCase {
  constructor(private readonly wsGateway: GameWsGateway) {}

  async execute(input: {
    userId: number
    roomId: number
  }): Promise<ApiVoidResult> {
    const { userId, roomId } = input
    const roomKey = String(roomId)

    const pre = await prisma.room.findUnique({
      where: { id: roomId },
      select: { id: true, gameStatus: true, deletedAt: true }
    })
    if (!pre || pre.deletedAt) {
      this.wsGateway.disconnectUserGameSockets(roomId, userId)
      return { ok: true, data: null }
    }

    const memberPre = await prisma.roomMember.findUnique({
      where: { roomId_userId: { roomId, userId } },
      select: { userId: true }
    })
    if (!memberPre) {
      this.wsGateway.disconnectUserGameSockets(roomId, userId)
      return { ok: true, data: null }
    }

    const texasPre = gameRuntimeRegistry.getTexas(roomKey)
    if (texasPre && !texasPre.room.has(userId)) {
      this.wsGateway.disconnectUserGameSockets(roomId, userId)
      return { ok: true, data: null }
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

    const shouldDeferTexasSeatRemoval = pre.gameStatus === 'in_hand'
    if (pre.gameStatus === 'in_hand' && !texasPre) {
      return {
        ok: false,
        status: HTTP_STATUS.CONFLICT,
        message: '房间状态与对局引擎不一致，请稍后重试或联系管理员'
      }
    }

    if (shouldDeferTexasSeatRemoval) {
      gameRuntimeRegistry.queueLeaveDuringHand(roomKey, userId)
    }

    const txRes: QuitTxResult = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM \`Room\` WHERE id = ${roomId} FOR UPDATE`

      const latestRoom = await tx.room.findUnique({
        where: { id: roomId },
        select: {
          id: true,
          ownerId: true,
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

      if (latestRoom.gameStatus === 'in_hand' && !shouldDeferTexasSeatRemoval) {
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

      let newOwnerId: number | null = null
      if (latestRoom.ownerId === userId && memberCount > 1) {
        const nextOwnerMember = await tx.roomMember.findFirst({
          where: { roomId, userId: { not: userId } },
          orderBy: { joinedAt: 'asc' }
        })
        if (nextOwnerMember) {
          await tx.room.update({
            where: { id: roomId },
            data: {
              ownerId: nextOwnerMember.userId,
              activeOwnerId: nextOwnerMember.userId
            }
          })
          newOwnerId = nextOwnerMember.userId
        }
      }

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
        newOwnerId,
        deferTexasSeatRemoval: shouldDeferTexasSeatRemoval
      }
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
      return { ok: true, data: null }
    }

    if (!txRes.deferTexasSeatRemoval) {
      gameRuntimeRegistry.cancelQueuedLeave(roomKey, userId)
    }
    const texas = gameRuntimeRegistry.getTexas(roomKey)

    if (texas) {
      try {
        if (txRes.newOwnerId != null) {
          texas.room.setOwnerById(txRes.newOwnerId)
        }
        gameRuntimeRegistry.removePendingPostBigBlind(roomKey, userId)
        if (!txRes.deferTexasSeatRemoval) {
          texas.room.removeById(userId)
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
      } else {
        const seatedCount = texas.room.getPlayersBySeatStatus('on-set').length
        if (txRes.restCount < 2 || seatedCount < 2) {
          cancelNextHandCountdown(roomId)
        }
      }
    } else if (txRes.deletedRoom) {
      try {
        unregisterNextHandHooks(roomId)
      } catch (e) {
        logger.error('[quitGame] unregisterNextHandHooks (no texas) failed', e)
      }
    }

    if (!txRes.deferTexasSeatRemoval) {
      this.wsGateway.notifyPlayerQuitGame(roomKey, { roomId, userId })
    }

    if (txRes.deletedRoom) {
      this.wsGateway.broadcastRoomListRoomDeleted(roomId)
    } else {
      this.wsGateway.broadcastRoomListMemberCountChanged({
        roomId,
        memberCount: txRes.restCount
      })
    }

    this.wsGateway.disconnectUserGameSockets(roomId, userId)

    return { ok: true, data: null }
  }
}
