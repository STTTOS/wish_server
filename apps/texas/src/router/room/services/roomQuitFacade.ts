import type { ApiVoidResult } from '../../../utils/apiResult'
import type { WaitingRoomGateway } from './waitingRoomGateway'

import prisma from '../../../models'
import { validateRoomQuitAuth } from './roomQuitValidator'
import { HTTP_STATUS } from '../../../constants/httpStatus'

export type RoomQuitResult = ApiVoidResult

type RoomQuitTxResult =
  | { quitNoop: true }
  | {
      quitNoop: false
      restCount: number
      deletedRoom: boolean
      newOwnerId: number | null
    }

export class RoomQuitFacade {
  constructor(private readonly waitingRoomGateway: WaitingRoomGateway) {}

  async execute(input: {
    roomCode: unknown
    userId: number
  }): Promise<RoomQuitResult> {
    const auth = await validateRoomQuitAuth({ roomCode: input.roomCode })
    if (!auth.ok) return auth

    // 房间已软删：幂等退出，只保证 socket 状态一致
    if (auth.data.isRoomDeleted) {
      this.waitingRoomGateway.removeUserFromWaitingRoom(
        auth.data.roomId,
        input.userId
      )
      return { ok: true, data: null }
    }

    const { roomId } = auth.data
    let txRes: RoomQuitTxResult
    try {
      txRes = await prisma.$transaction(async (tx) => {
        const compoundKey = { roomId, userId: input.userId }

        await tx.$queryRaw`SELECT id FROM \`Room\` WHERE id = ${roomId} FOR UPDATE`

        const latestRoom = await tx.room.findUnique({
          where: { id: roomId },
          select: { ownerId: true, gameStatus: true, deletedAt: true }
        })

        if (!latestRoom || latestRoom.deletedAt) {
          return { quitNoop: true }
        }
        if (latestRoom.gameStatus !== 'waiting') {
          throw new Error('仅等待房间状态支持退出房间')
        }

        const member = await tx.roomMember.findUnique({
          where: { roomId_userId: compoundKey } // eslint-disable-line camelcase
        })
        if (!member) {
          return { quitNoop: true }
        }

        const memberCount = await tx.roomMember.count({ where: { roomId } })

        let newOwnerId: number | null = null
        if (latestRoom.ownerId === input.userId && memberCount > 1) {
          const nextOwnerMember = await tx.roomMember.findFirst({
            where: {
              roomId,
              userId: { not: input.userId }
            },
            orderBy: { joinedAt: 'asc' }
          })
          if (nextOwnerMember) {
            await tx.room.update({
              where: { id: roomId },
              data: { ownerId: nextOwnerMember.userId }
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
            data: { deletedAt: new Date() }
          })
          deletedRoom = true
        }

        return { quitNoop: false, restCount, deletedRoom, newOwnerId }
      })
    } catch (e) {
      return {
        ok: false,
        status:
          e instanceof Error && e.message === '仅等待房间状态支持退出房间'
            ? HTTP_STATUS.CONFLICT
            : HTTP_STATUS.INTERNAL_SERVER_ERROR,
        message: e instanceof Error ? e.message : '退出房间失败'
      }
    }

    if (txRes.quitNoop) {
      this.waitingRoomGateway.removeUserFromWaitingRoom(roomId, input.userId)
      return { ok: true, data: null }
    }

    // 先广播「成员离开 / 房主变更 / 列表人数」，再 removeUserFromWaitingRoom
    if (txRes.newOwnerId != null) {
      this.waitingRoomGateway.broadcastWaitingRoomOwnerChanged(roomId, {
        oldOwnerId: input.userId,
        newOwnerId: txRes.newOwnerId
      })
    }

    this.waitingRoomGateway.broadcastWaitingRoomMemberLeft(roomId, {
      userId: input.userId,
      reason: 'quit'
    })

    if (txRes.deletedRoom) {
      this.waitingRoomGateway.broadcastRoomListRoomDeleted(roomId)
    } else {
      this.waitingRoomGateway.broadcastRoomListMemberCountChanged(
        roomId,
        txRes.restCount
      )
    }

    this.waitingRoomGateway.removeUserFromWaitingRoom(roomId, input.userId)
    return { ok: true, data: null }
  }
}
