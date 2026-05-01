import type { RoomGameStatus } from '@prisma/texas-client'

/**
 * 列表/详情展示用：除 `waiting`（大厅）外均视为「游戏中」（含 entering / starting_hand / in_hand / between_hands）。
 */
export type RoomPlaySession = 'lobby' | 'in_game'

export function roomPlaySessionFromGameStatus(
  gameStatus: RoomGameStatus
): RoomPlaySession {
  return gameStatus === 'waiting' ? 'lobby' : 'in_game'
}
