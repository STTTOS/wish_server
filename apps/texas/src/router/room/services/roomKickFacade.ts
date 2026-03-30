import type { ApiVoidResult } from '../../../utils/apiResult'
import type { WaitingRoomGateway } from './waitingRoomGateway'

import prisma from '../../../models'
import { validateRoomKickAuth } from './roomKickValidator'

export type RoomKickResult = ApiVoidResult

export class RoomKickFacade {
  constructor(private readonly waitingRoomGateway: WaitingRoomGateway) {}

  async execute(input: {
    roomCode: unknown
    targetUserId: unknown
    operatorId: number
  }): Promise<RoomKickResult> {
    const auth = await validateRoomKickAuth(input)
    if (!auth.ok) return auth

    const roomId = auth.data.roomId
    const targetUserId = input.targetUserId as number

    type KickTxResult =
      | { kickedNoop: true }
      | { kicked: true; memberCountAfterKick: number }

    let txRes: KickTxResult
    try {
      txRes = await prisma.$transaction(async (tx) => {
        const compoundKey = { roomId, userId: targetUserId }

        await tx.$queryRaw`SELECT id FROM \`Room\` WHERE id = ${roomId} FOR UPDATE`
        const latestRoom = await tx.room.findUnique({
          where: { id: roomId },
          select: { ownerId: true, gameStatus: true, deletedAt: true }
        })

        if (!latestRoom || latestRoom.deletedAt) throw new Error('房间不存在')
        if (latestRoom.ownerId !== input.operatorId)
          throw new Error('仅房主可以踢人')
        if (latestRoom.gameStatus !== 'waiting')
          throw new Error('仅等待房间状态支持踢人')

        const targetMember = await tx.roomMember.findUnique({
          where: { roomId_userId: compoundKey } // eslint-disable-line camelcase
        })
        if (!targetMember) {
          // 幂等：目标不存在时不报错、不推送离开消息；仅确保 WS 层不再算在线
          return { kickedNoop: true }
        }

        await tx.roomMember.delete({
          where: { roomId_userId: compoundKey } // eslint-disable-line camelcase
        })

        return {
          kicked: true,
          memberCountAfterKick: await tx.roomMember.count({ where: { roomId } })
        }
      })
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : '踢人失败'
      const errorCode = errorMessage === '仅房主可以踢人' ? 403 : 2000
      return { ok: false, code: errorCode, message: errorMessage }
    }

    // 即便 DB 已无该成员，也应确保 WS 层的 waiting-room 订阅被移除
    if ('kickedNoop' in txRes) {
      this.waitingRoomGateway.removeUserFromWaitingRoom(roomId, targetUserId)
      return { ok: true, data: undefined }
    }

    this.waitingRoomGateway.broadcastWaitingRoomMemberLeft(roomId, {
      userId: targetUserId
    })
    // 先广播离开事件给客户端，再移除其 waiting-room 订阅
    this.waitingRoomGateway.removeUserFromWaitingRoom(roomId, targetUserId)
    this.waitingRoomGateway.broadcastRoomListMemberCountChanged(
      roomId,
      txRes.memberCountAfterKick
    )

    return { ok: true, data: undefined }
  }
}
