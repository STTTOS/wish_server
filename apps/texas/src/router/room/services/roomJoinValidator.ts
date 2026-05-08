import type { ApiResult } from '../../../utils/apiResult'

import { room, user } from '../../../models'
import { HTTP_STATUS } from '../../../constants/httpStatus'

export type RoomJoinAuthData = {
  roomId: number
  joinUser: {
    id: number
    name: string
    avatarUrl: string | null
    avatarKey: string
    pokerBackgroundKey: string
  }
}
export type RoomJoinAuthResult = ApiResult<RoomJoinAuthData>

/**
 * 成员加入校验器（validator）：
 * - 输入校验
 * - 房间存在且未删、且 **`gameStatus === 'waiting'`**（非等待阶段请走 `POST /game/join`）
 * - 用户存在
 *
 * 并发正确性依赖 Facade 内的事务二次校验（锁房间行、再校验人数/重复/跨房）。
 */
export async function validateRoomJoinAuth(input: {
  roomCode: string
  userId: number
}): Promise<RoomJoinAuthResult> {
  const { roomCode, userId } = input

  if (!roomCode || !roomCode.trim()) {
    return {
      ok: false,
      status: HTTP_STATUS.BAD_REQUEST,
      message: '房间代码不能为空'
    }
  }

  const roomInfo = await room.findUnique({
    where: { activeCode: roomCode.trim().toUpperCase() },
    select: { id: true, ownerId: true, gameStatus: true, deletedAt: true }
  })

  if (!roomInfo || roomInfo.deletedAt) {
    return {
      ok: false,
      status: HTTP_STATUS.NOT_FOUND,
      message: '房间不存在或房间代码错误'
    }
  }

  if (roomInfo.gameStatus !== 'waiting') {
    return {
      ok: false,
      status: HTTP_STATUS.CONFLICT,
      message:
        '对局已开始或不在等待阶段，请使用加入对局接口（POST /game/join，body 含 roomId）'
    }
  }

  const joinUser = await user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      avatarUrl: true,
      avatarKey: true,
      pokerBackgroundKey: true
    }
  })

  if (!joinUser) {
    return { ok: false, status: HTTP_STATUS.NOT_FOUND, message: '用户不存在' }
  }

  return {
    ok: true,
    data: {
      roomId: roomInfo.id,
      joinUser: {
        id: joinUser.id,
        name: joinUser.name,
        avatarUrl: joinUser.avatarUrl,
        avatarKey: joinUser.avatarKey,
        pokerBackgroundKey: joinUser.pokerBackgroundKey
      }
    }
  }
}
