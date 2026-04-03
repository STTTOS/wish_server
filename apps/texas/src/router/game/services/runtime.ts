import type { StartRoomInfo, StartRoomMember } from './types'

import { Texas } from 'texas-poker-core'

import { match } from '../../../models'
import { GameWsGateway } from './gameWsGateway'
import {
  GAME_WS_STAGE_CHANGED_DELAY_MS,
  GAME_WS_ACTION_REQUIRED_DELAY_MS
} from '../../../constants/game'

function sleep(ms: number) {
  return ms <= 0
    ? Promise.resolve()
    : new Promise<void>((resolve) => setTimeout(resolve, ms))
}

/**
 * 创建 Texas 实例并将房间成员全部入座。
 */
export function createTexasAndSeatPlayers(params: {
  roomInfo: StartRoomInfo
  members: StartRoomMember[]
  ownerId: number
}) {
  const { roomInfo, members, ownerId } = params
  const texas = new Texas({
    lowestBetAmount: roomInfo.lowestBetAmount,
    maximumCountOfPlayers: members.length,
    initialChips: roomInfo.initialChips,
    thinkingTime: roomInfo.thinkingTime,
    user: { id: roomInfo.owner.id, name: roomInfo.owner.name },
    beforeStageAdvance: () => sleep(GAME_WS_STAGE_CHANGED_DELAY_MS),
    beforeNextPlayerTurn: () => sleep(GAME_WS_ACTION_REQUIRED_DELAY_MS)
  })

  const ownerPlayer = texas.room.owner
  texas.room.seat(ownerPlayer)
  for (const m of members) {
    if (m.userId === ownerId) continue
    const p = texas.createPlayer({ id: m.user.id, name: m.user.name })
    texas.room.join(p)
    texas.room.seat(p)
  }
  return texas
}

/**
 * 创建首手 Match，并向 waiting-room 广播 game-entered。
 */
export async function createInitialMatchAndNotifyEntered(params: {
  roomId: number
  userIds: number[]
  roomInfo: StartRoomInfo
  wsGateway?: GameWsGateway
}) {
  const { roomId, userIds, roomInfo, wsGateway = new GameWsGateway() } = params
  const matchInfo = await match.create({
    data: {
      roomId,
      lowestBetAmount: roomInfo.lowestBetAmount
    }
  })
  wsGateway.notifyEntered(roomId, matchInfo.id, userIds)
  return matchInfo
}
