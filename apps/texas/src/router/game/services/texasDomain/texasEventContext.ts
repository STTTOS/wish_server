import type { Texas } from 'texas-poker-core'
import type { StartRoomInfo } from '../types'
import type { GameRuntime } from '../runtimeRegistry'

import { GameWsGateway } from '../gameWsGateway'
import { gameRuntimeRegistry } from '../runtimeRegistry'

export type TexasEventContext = {
  texas: Texas
  roomId: number
  roomKey: string
  roomInfo: StartRoomInfo
  wsGateway: GameWsGateway
  getRuntime: () => GameRuntime
}

export function buildTexasEventContext(params: {
  texas: Texas
  roomId: number
  roomKey: string
  roomInfo: StartRoomInfo
  wsGateway: GameWsGateway
  getRuntime: () => GameRuntime
}): TexasEventContext {
  return { ...params }
}

export function getTexasEventContextForRoom(
  roomKey: string
): TexasEventContext {
  const rt = gameRuntimeRegistry.getOrThrow(roomKey)
  return buildTexasEventContext({
    texas: rt.texas,
    roomId: rt.roomId,
    roomKey,
    roomInfo: rt.roomInfo,
    wsGateway: new GameWsGateway(),
    getRuntime: () => gameRuntimeRegistry.getOrThrow(roomKey)
  })
}
