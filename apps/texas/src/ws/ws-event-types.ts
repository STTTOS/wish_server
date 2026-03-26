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
  rank: number
  isAllIn: boolean
  isFold: boolean
  handPokes: Poke[]
  rankCategory: RankCategory
}

export type WsGameEndData = {
  matchId: number
  settleList: WsGameEndSettleItem[]
  pokesToReveal: Poke[]
  endStage: StageEnum
  bestRankCategory: RankCategory
  gameDuration: number
  bestPokes: Array<Poke[]>
  totalBetAmount: number
}

export type WsGameEnteringData = {
  roomId: number
}

export type WsEventDataMap = {
  'game-entering': WsGameEnteringData
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
