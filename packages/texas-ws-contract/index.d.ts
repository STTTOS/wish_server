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
    /** 本手开局、贴盲注前的桌上可下注余额（引擎真值；续局时未必等于房间 initialChips） */
    balance: number
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
  posts: Array<{ userId: number; amount: number; kind: 'sb' | 'bb'; balance: number }>
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
  playerProfiles: WsPlayerProfileItem[]
}

export type WsPlayerProfileItem = {
  userId: number
  name: string
  avatarUrl: string | null
  avatarKey: string
}

export type WsGameEndSettleItem = {
  userId: number
  name: string
  avatarUrl: string | null
  avatarKey: string
  pokerBackgroundKey: string | null
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

/** 玩家已提交退出（用于客户端提示，不代表已从牌桌摘除）。 */
export type WsPlayerLeftGameData = {
  roomId: number
  userId: number
}

export type WsGameRoomClosedData = {
  roomId: number
  reason: 'insufficient_players'
}

/** 局间由观战席转为在座（用于客户端刷新 PlayerSet）。 */
export type WsPlayersSeatedData = {
  roomId: number
  matchId: number | null
  userIds: number[]
}

export type WsPlayersPostedBigBlindData = {
  roomId: number
  matchId: number | null
  seatedUserIds: number[]
  posts: Array<{
    userId: number
    amount: number
    balance: number
    totalBetAmount: number
    currentStageBetAmount: number
  }>
  pool: number
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
  'player-left-game': WsPlayerLeftGameData
  'player-quit-game': WsPlayerQuitGameData
  'game-room-closed': WsGameRoomClosedData
  'players-seated': WsPlayersSeatedData
  'players-posted-big-blind': WsPlayersPostedBigBlindData
  'player-hand-voluntarily-shown': WsPlayerHandVoluntarilyShownData
  'game-room-replay': WsGameRoomReplayData
}

export type WsEventType = keyof WsEventDataMap

export type WsMessage<T extends WsEventType = WsEventType> = {
  type: T
  data: WsEventDataMap[T]
}

/**
 * room-list / waiting-room 命名空间事件（不属于 /game 流）。
 */
export type WsWaitingRoomMemberJoinedData = {
  userId: number
  name: string
  avatarUrl: string | null
  avatarKey: string
  pokerBackgroundKey: string
  joinedAt: string
  isOwner: boolean
}

export type WsWaitingRoomMemberLeftData = {
  userId: number
  reason: 'quit' | 'kick'
  operatorId?: number
}

export type WsWaitingRoomMemberPresenceData = {
  userId: number
  online: boolean
}

export type WsWaitingRoomOwnerChangedData = {
  oldOwnerId: number
  newOwnerId: number
}

export type WsRoomListMemberCountChangedData = {
  roomId: number
  memberCount: number
}

export type WsRoomListPlaySession = 'lobby' | 'in_game'

export type WsRoomListPlaySessionChangedData = {
  roomId: number
  playSession: WsRoomListPlaySession
}

export type WsRoomListRoomDeletedData = {
  roomId: number
}

export type WsRoomListRoomCreatedData = {
  id: number
  code: string
  owner: {
    id: number
    name: string
    avatarUrl: string | null
    avatarKey: string
    pokerBackgroundKey: string
  }
  initialChips: number
  thinkingTime: number
  lowestBetAmount: number
  createdAt: string
  memberCount: number
  playSession: WsRoomListPlaySession
}

export type RoomWsEventDataMap = {
  'waiting-room-member-joined': WsWaitingRoomMemberJoinedData
  'waiting-room-member-left': WsWaitingRoomMemberLeftData
  'waiting-room-member-presence': WsWaitingRoomMemberPresenceData
  'waiting-room-owner-changed': WsWaitingRoomOwnerChangedData
  'room-list-member-count-changed': WsRoomListMemberCountChangedData
  'room-list-play-session-changed': WsRoomListPlaySessionChangedData
  'room-list-room-deleted': WsRoomListRoomDeletedData
  'room-list-room-created': WsRoomListRoomCreatedData
}

export type RoomWsEventType = keyof RoomWsEventDataMap

export type RoomWsMessage<T extends RoomWsEventType = RoomWsEventType> = {
  type: T
  data: RoomWsEventDataMap[T]
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
