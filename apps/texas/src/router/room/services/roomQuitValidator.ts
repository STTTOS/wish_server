import type { ApiResult } from '../../../utils/apiResult'

import { room } from '../../../models'
import { HTTP_STATUS } from '../../../constants/httpStatus'

export type RoomQuitAuthData = { roomId: number; isRoomDeleted: boolean }
export type RoomQuitAuthResult = ApiResult<RoomQuitAuthData>

/**
 * 退出房间的校验器（validator）。
 * - 输入校验
 * - 房间存在性/是否已软删
 * - 房间处于 waiting 才允许进行数据库删除（幂等与“成员不存在”走事务内 quitNoop）
 */
export async function validateRoomQuitAuth(input: {
  roomId: unknown
}): Promise<RoomQuitAuthResult> {
  const roomId = Number(input.roomId)
  if (!Number.isFinite(roomId) || roomId <= 0) {
    return {
      ok: false,
      status: HTTP_STATUS.BAD_REQUEST,
      message: '参数异常：需要 roomId'
    }
  }

  const roomInfo = await room.findUnique({
    where: { id: roomId },
    select: { id: true, deletedAt: true, gameStatus: true }
  })

  if (!roomInfo) {
    return { ok: false, status: HTTP_STATUS.NOT_FOUND, message: '房间不存在' }
  }

  if (roomInfo.deletedAt) {
    return { ok: true, data: { roomId: roomInfo.id, isRoomDeleted: true } }
  }

  if (roomInfo.gameStatus !== 'waiting') {
    return {
      ok: false,
      status: HTTP_STATUS.CONFLICT,
      message: '仅等待房间状态支持退出房间'
    }
  }

  return { ok: true, data: { roomId: roomInfo.id, isRoomDeleted: false } }
}
