import type { ApiResult } from '../../../utils/apiResult'

import { room } from '../../../models'
import { HTTP_STATUS } from '../../../constants/httpStatus'

export type RoomKickAuthData = { roomId: number }
export type RoomKickAuthResult = ApiResult<RoomKickAuthData>

export async function validateRoomKickAuth(input: {
  roomId: unknown
  targetUserId: unknown
  operatorId: number
}): Promise<RoomKickAuthResult> {
  const { targetUserId, operatorId } = input
  const roomId = Number(input.roomId)
  if (
    !Number.isFinite(roomId) ||
    roomId <= 0 ||
    typeof targetUserId !== 'number' ||
    !Number.isFinite(targetUserId)
  ) {
    return {
      ok: false,
      status: HTTP_STATUS.BAD_REQUEST,
      message: '参数异常：需要 roomId 和 targetUserId'
    }
  }

  const roomInfo = await room.findUnique({
    where: { id: roomId },
    select: { id: true, ownerId: true, gameStatus: true, deletedAt: true }
  })

  if (!roomInfo || roomInfo.deletedAt) {
    return { ok: false, status: HTTP_STATUS.NOT_FOUND, message: '房间不存在' }
  }

  if (roomInfo.gameStatus !== 'waiting') {
    return {
      ok: false,
      status: HTTP_STATUS.CONFLICT,
      message: '仅等待房间状态支持踢人'
    }
  }

  if (roomInfo.ownerId !== operatorId) {
    return {
      ok: false,
      status: HTTP_STATUS.FORBIDDEN,
      message: '仅房主可以踢人'
    }
  }

  if (roomInfo.ownerId === targetUserId) {
    return {
      ok: false,
      status: HTTP_STATUS.BAD_REQUEST,
      message: '不能踢出房主'
    }
  }

  return { ok: true, data: { roomId: roomInfo.id } }
}
