import type {
  ActionType,
  Poke,
  RankCategory,
  RoleEnum,
  StageEnum
} from 'texas-poker-core'

export type WsPlayerRolesAssignedData = {
  matchId: number
  roles: Array<{
    userId: number
    role: RoleEnum
    actionIndex: number
  }>
}

export type WsPlayerHandDealtData = {
  matchId: number
  roomId: number
  handPokes: Poke[]
}

export type WsGameStartData = {
  matchId: number
}

export type WsGameBlindsPostedData = {
  matchId: number
  roomId: number
  posts: Array<{ userId: number; amount: number; kind: 'sb' | 'bb' }>
  pool: number
}

export type WsPlayerActionRequiredData = {
  matchId: number
  userId: number
  serverNow: number
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
  actionId: number
  actionType: ActionType
  amount: number
  pool: number
  totalBetAmount: number
  currentStageBetAmount: number
  balance: number
}

export type WsGameStageChangedData = {
  matchId: number
  stage: StageEnum
  pokesToReveal: Poke[]
}

export type WsMatchOverviewWagerItem = {
  userId: number
  totalWager: number
  chipTopUpCount: number
  chipTopUpAmount: number
}

export type WsMatchOverviewBillItem = {
  fromUserId: number
  toUserId: number
  amount: number
}

export type WsMatchOverview = {
  billList: WsMatchOverviewBillItem[]
  wagerList: WsMatchOverviewWagerItem[]
}

export type WsGameEndSettleItem = {
  userId: number
  balance: number
  wager: number
  isAllIn: boolean
  isFold: boolean
  canVoluntaryShowHand: boolean
  handPokes: Poke[]
  rankCategory?: RankCategory
  rankStrength?: number
}

export type WsGameEndData = {
  matchId: number
  settleList: WsGameEndSettleItem[]
  matchOverview: WsMatchOverview
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

export type WsPlayerChipTopUpData = {
  roomId: number
  userId: number
  afterMatchId: number
  topUpAmount: number
  balanceAfter: number
}

export type WsPlayerBuiltInVoiceData = {
  userId: number
  voiceName: string
}

export type WsPlayerQuitGameData = {
  roomId: number
  userId: number
}

export type WsPlayerHandVoluntarilyShownData = {
  roomId: number
  matchId: number
  userId: number
  handPokes: Poke[]
  rankCategory: RankCategory | null
}

export type WsGameRoomReplayItem = {
  seq: number
  payload: Record<string, unknown>
}

export type WsGameRoomReplayData = {
  roomId: number
  afterSeq: number
  throughSeq: number
  latestSeq: number
  events: WsGameRoomReplayItem[]
  truncated?: boolean
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
  'game-blinds-posted': WsGameBlindsPostedData
  'player-action-required': WsPlayerActionRequiredData
  'player-action-taken': WsPlayerActionTakenData
  'game-stage-changed': WsGameStageChangedData
  'game-end': WsGameEndData
  'player-chip-top-up': WsPlayerChipTopUpData
  'player-built-in-voice': WsPlayerBuiltInVoiceData
  'player-quit-game': WsPlayerQuitGameData
  'player-hand-voluntarily-shown': WsPlayerHandVoluntarilyShownData
  'game-room-replay': WsGameRoomReplayData
}

export type WsEventType = keyof WsEventDataMap

export type WsMessage<T extends WsEventType = WsEventType> = {
  type: T
  data: WsEventDataMap[T]
}

export type PostGameTakeActionParams = {
  actionType: ActionType
  amount?: number
}

export type PostGameShowMyHandPokesParams = {
  roomId: number
  matchId: number
}

export type PostGameSendBuiltInVoiceParams = {
  roomId: number
  voiceName: string
}
