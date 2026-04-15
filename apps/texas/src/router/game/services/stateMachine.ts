import type { RoomGameStatus } from '@prisma/texas-client'

import { room as roomModel } from '../../../models'

const allowedTransitions: Record<RoomGameStatus, RoomGameStatus[]> = {
  waiting: ['entering'],
  entering: ['starting_hand', 'waiting'],
  starting_hand: ['in_hand', 'between_hands', 'waiting'],
  in_hand: ['between_hands'],
  between_hands: ['starting_hand', 'waiting']
}

/**
 * 轻量状态迁移守卫：仅允许定义过的 gameStatus 迁移。
 */
export async function transitionRoomGameStatus(
  roomId: number,
  to: RoomGameStatus
) {
  const info = await roomModel.findUnique({
    where: { id: roomId },
    select: { gameStatus: true }
  })
  if (!info) throw new Error('room not found')

  const from = info.gameStatus
  if (!allowedTransitions[from]?.includes(to)) {
    throw new Error(`invalid room status transition: ${from} -> ${to}`)
  }

  await roomModel.update({
    where: { id: roomId },
    data: { gameStatus: to }
  })
}
