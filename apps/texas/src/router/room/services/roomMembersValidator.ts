import type { ApiResult } from '../../../utils/apiResult'

import { room, roomMember } from '../../../models'
import { ERROR_CODE } from '../../../constants/errorCodes'

export type RoomMembersAuthData = { roomId: number; ownerId: number }
export type RoomMembersAuthResult = ApiResult<RoomMembersAuthData>

/**
 * 成员列表查询的校验器（validator）：
 * - 入参：roomCode / userId
 * - 房间存在且未软删
 * - 当前用户在该房间中（roomMember 存在）
 */
export async function validateRoomMembersAuth(input: {
  roomCode: string
  userId: number
}): Promise<RoomMembersAuthResult> {
  const { roomCode, userId } = input
  if (!roomCode || !roomCode.trim()) {
    return {
      ok: false,
      code: ERROR_CODE.BAD_REQUEST,
      message: '参数异常：需要 roomCode'
    }
  }

  const roomInfo = await room.findUnique({
    where: { code: roomCode.trim().toUpperCase() },
    select: { id: true, ownerId: true, deletedAt: true }
  })
  if (!roomInfo || roomInfo.deletedAt) {
    return {
      ok: false,
      code: ERROR_CODE.COMMON_FAIL,
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
      code: ERROR_CODE.FORBIDDEN,
      message: '无权查看该房间成员'
    }
  }

  return { ok: true, data: { roomId: roomInfo.id, ownerId: roomInfo.ownerId } }
}
