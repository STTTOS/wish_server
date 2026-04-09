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
    }

/**
 * 局间退出对局：删成员、可选房主转移/软删房；同步 Texas 座位；广播 + 断开 /game。
 */
export class QuitGameUseCase {
  constructor(private readonly wsGateway: GameWsGateway) {}

  async execute(input: {
    userId: number
    roomId: number
  }): Promise<ApiVoidResult> {
    const { userId, roomId } = input

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

      if (latestRoom.gameStatus !== 'between_hands') {
        return {
          kind: 'fail',
          status: HTTP_STATUS.CONFLICT,
          message: '仅局间（between_hands）可退出对局'
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
          data: { deletedAt: new Date(), activeOwnerId: null }
        })
        deletedRoom = true
      }

      return { kind: 'done', restCount, deletedRoom, newOwnerId }
    })

    if (txRes.kind === 'fail') {
      return {
        ok: false,
        status: txRes.status,
        message: txRes.message
      }
    }

    if (txRes.kind === 'noop') {
      this.wsGateway.disconnectUserGameSockets(roomId, userId)
      return { ok: true, data: null }
    }

    const roomKey = String(roomId)
    const texas = gameRuntimeRegistry.getTexas(roomKey)

    if (texas) {
      try {
        if (txRes.newOwnerId != null) {
          texas.room.setOwnerById(txRes.newOwnerId)
        }
        texas.room.removeById(userId)
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
      } else if (texas.room.getPlayersBySeatStatus('on-set').length < 2) {
        cancelNextHandCountdown(roomId)
      }
    } else if (txRes.deletedRoom) {
      try {
        unregisterNextHandHooks(roomId)
      } catch (e) {
        logger.error('[quitGame] unregisterNextHandHooks (no texas) failed', e)
      }
    }

    this.wsGateway.notifyPlayerQuitGame(roomKey, { roomId, userId })

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
