import type { StartGameValidationResult } from './types'

import { GameWsGateway } from './gameWsGateway'
import { HTTP_STATUS } from '../../../constants/httpStatus'
import { roomMember, room as roomModel } from '../../../models'

/**
 * 校验“房主点击开始游戏”请求，返回后续流程所需上下文。
 */
export async function validateStartGameRequest(
  roomId: number,
  ownerId: number
): Promise<StartGameValidationResult> {
  const roomInfo = await roomModel.findUnique({
    where: { id: roomId },
    include: { owner: true }
  })
  if (!roomInfo || roomInfo.deletedAt) {
    return { ok: false, status: HTTP_STATUS.NOT_FOUND, message: '房间不存在' }
  }
  if (roomInfo.ownerId !== ownerId) {
    return {
      ok: false,
      status: HTTP_STATUS.FORBIDDEN,
      message: '仅房主可开始游戏'
    }
  }
  const roomGameStatus = roomInfo.gameStatus
  if (roomGameStatus !== 'waiting') {
    return {
      ok: false,
      status: HTTP_STATUS.CONFLICT,
      message: '房间已开始或正在进入游戏中'
    }
  }

  const members = await roomMember.findMany({
    where: { roomId },
    include: { user: true },
    orderBy: { joinedAt: 'asc' }
  })
  if (members.length < 2) {
    return {
      ok: false,
      status: HTTP_STATUS.CONFLICT,
      message: '人数不足，无法开始游戏'
    }
  }

  return { ok: true, data: { roomInfo, members } }
}

/**
 * 将房间标记为 entering 并通知等待房间用户准备连接 /game。
 */
export async function markRoomEnteringAndNotify(
  roomId: number,
  userIds: number[],
  wsGateway = new GameWsGateway()
) {
  await roomModel.update({
    where: { id: roomId },
    data: { gameStatus: 'entering' }
  })
  wsGateway.notifyEntering(roomId)
  wsGateway.trackEntering(roomId, userIds)
}
