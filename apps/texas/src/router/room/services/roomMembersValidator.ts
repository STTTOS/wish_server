import type { ApiResult } from '../../../utils/apiResult'

import { room, roomMember } from '../../../models'
import { HTTP_STATUS } from '../../../constants/httpStatus'

export type RoomMembersAuthData = { roomId: number; ownerId: number }
export type RoomMembersAuthResult = ApiResult<RoomMembersAuthData>

/**
 * 成员列表查询的校验器（validator）：
 * - 入参：roomId / userId
 * - 房间存在且未软删
 * - 当前用户在该房间中（roomMember 存在）
 */
export async function validateRoomMembersAuth(input: {
  roomId: number
  userId: number
}): Promise<RoomMembersAuthResult> {
  const roomId = Number(input.roomId)
  const { userId } = input
  if (!Number.isFinite(roomId) || roomId <= 0) {
    return {
      ok: false,
      status: HTTP_STATUS.BAD_REQUEST,
      message: '参数异常：需要 roomId'
    }
  }

  const roomInfo = await room.findUnique({
    where: { id: roomId },
    select: { id: true, ownerId: true, deletedAt: true }
  })
  if (!roomInfo || roomInfo.deletedAt) {
    return {
      ok: false,
      status: HTTP_STATUS.NOT_FOUND,
      message: '房间不存在'
    }
  }

  const selfMember = await roomMember.findUnique({
    where: {
      // eslint-disable-next-line camelcase
      roomId_userId: {
        roomId: roomInfo.id,
        userId
      }
    }
  })
  if (!selfMember) {
    return {
      ok: false,
      status: HTTP_STATUS.FORBIDDEN,
      message: '无权查看该房间成员'
    }
  }

  return { ok: true, data: { roomId: roomInfo.id, ownerId: roomInfo.ownerId } }
}
