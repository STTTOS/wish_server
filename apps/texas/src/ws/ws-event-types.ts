import type {
  Poke,
  RoleEnum,
  StageEnum,
  ActionType,
  RankCategory
} from 'texas-poker-core'

export type WsPlayerRolesAssignedData = {
  matchId: number
  roles: Array<{
    userId: number
    role: RoleEnum
  }>
}

export type WsPlayerHandDealtData = {
  matchId: number
  roomId: number
  handPokes: Poke[]
}

export type WsGameStartData = {
  matchId: number
  stage: StageEnum
  pool: number
  defaultBets: Array<{
    userId: number
    amount: number
    balance: number
  }>
}

export type WsPlayerActionRequiredData = {
  matchId: number
  userId: number
  /** server unix ms timestamp, for client clock calibration */
  serverNow: number
  /** when this turn countdown ends (unix ms timestamp) */
  deadlineAt: number
  allowedActions: ActionType[]
  restrict?: {
    min: number
    max: number
  }
}

export type WsPlayerActionTakenData = {
  matchId: number
  userId: number
  actionType: ActionType
  amount: number
  pool: number
  currentStageBetAmount: number
  balance: number
}

export type WsGameStageChangedData = {
  matchId: number
  stage: StageEnum
  pokesToReveal: Poke[]
}

export type WsGameEndSettleItem = {
  userId: number
  balance: number
  wager: number
  // rank: number
  isAllIn: boolean
  isFold: boolean
  handPokes: Poke[]
  rankCategory?: RankCategory
  /** 与 handPokes 同规则：他人视角下弃牌或未到摊牌时不下发 */
  rankStrength?: number
}

export type WsGameEndData = {
  matchId: number
  settleList: WsGameEndSettleItem[]
  pokesToReveal: Poke[]
  /** 最后一轮可操作下注结束时的阶段（引擎 currentStage） */
  lastActionStage: StageEnum
  /** 公共牌发到哪一街（引擎 endStage） */
  boardThroughStage: StageEnum
  bestRankCategory?: RankCategory
  gameDuration: number
  bestPokes: Array<Poke[]>
  totalBetAmount: number
}

export type WsGameEnteringData = {
  roomId: number
}

export type WsGameEnteringProgressData = {
  roomId: number
  expectedUserIds: number[]
  connectedUserIds: number[]
}

export type WsGameEnteredData = {
  roomId: number
  matchId: number
  userIds: number[]
}

export type WsGameEnteringResolvedData = {
  roomId: number
  outcome: 'back_waiting_room' | 'destroy_room'
  connectedUserIds: number[]
  kickedUserIds: number[]
  ownerId: number | null
}

export type WsGameInvalidatedData = {
  roomId: number
  matchId: number
  reason: string
  source: 'engine_error' | 'insufficient_players'
  players: Array<{
    userId: number
    role: RoleEnum | null
    balance: number
  }>
}

export type WsNextHandCountdownStartedData = {
  roomId: number
  endsAt: number
  lockAt: number
  serverNow: number
}

export type WsNextHandCountdownCancelledData = {
  roomId: number
}

export type WsEventDataMap = {
  'game-entering': WsGameEnteringData
  'game-entering-progress': WsGameEnteringProgressData
  'game-entered': WsGameEnteredData
  'game-entering-resolved': WsGameEnteringResolvedData
  'game-invalidated': WsGameInvalidatedData
  'next-hand-countdown-started': WsNextHandCountdownStartedData
  'next-hand-countdown-cancelled': WsNextHandCountdownCancelledData
  'player-roles-assigned': WsPlayerRolesAssignedData
  'player-hand-dealt': WsPlayerHandDealtData
  'game-start': WsGameStartData
  'player-action-required': WsPlayerActionRequiredData
  'player-action-taken': WsPlayerActionTakenData
  'game-stage-changed': WsGameStageChangedData
  'game-end': WsGameEndData
}

export type WsEventType = keyof WsEventDataMap

export type WsMessage<T extends WsEventType = WsEventType> = {
  type: T
  data: WsEventDataMap[T]
}
