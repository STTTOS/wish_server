import type { Texas } from 'texas-poker-core'
import type { GameWsGateway } from './gameWsGateway'
import type { ApiResult } from '../../../utils/apiResult'
import type { GameRuntimeRegistry } from './runtimeRegistry'

export type StartRoomInfo = {
  id: number
  /** waiting-room owner id snapshot */
  ownerId: number
  deletedAt: Date | null
  lowestBetAmount: number
  initialChips: number
  thinkingTime: number
  isPrivate: boolean
  /** waiting-room owner profile snapshot (for entering -> in-game bootstrap only) */
  owner: {
    id: number
    name: string
  }
}

export type StartRoomMember = {
  userId: number
  user: {
    id: number
    name: string
  }
}

export type StartGameValidatedContext = {
  roomInfo: StartRoomInfo
  members: StartRoomMember[]
}

export type StartGameValidationResult = ApiResult<StartGameValidatedContext>

export type MatchRollbackManager = {
  /** 记录某一手开局快照（用于作废回滚和客户端恢复） */
  snapshotPlayersAtHandStart: (matchId: number) => void
  /** 作废当前手并回滚 DB/内存，再推送 game-invalidated */
  invalidateAndRollbackMatch: (
    source: 'engine_error' | 'insufficient_players',
    reason: string
  ) => Promise<void>
  clearInvalidatedFlag: (matchId: number) => void
  clearSnapshot: (matchId: number) => void
}

export type BindTexasLifecycleParams = {
  texas: Texas
  roomId: number
  roomKey: string
  roomInfo: StartRoomInfo
  runtimeRegistry: GameRuntimeRegistry
  wsGateway: GameWsGateway
}
