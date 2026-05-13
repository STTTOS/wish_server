import type {
  ActionType,
  Poke,
  RankCategory,
  RankSignature,
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
  /** 进街原因：正常下注轮结束 / 跑马路亮牌。 */
  advanceKind: 'betting_round_complete' | 'runout_reveal'
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
  sevenTwoBonusPaid: number
  sevenTwoBonusReceived: number
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
  /** 与 `bestPokes[0]` 对应的牌力签名；摊牌时下发，独赢弃牌可无此字段。 */
  bestRankSignature?: RankSignature
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

/** 引擎致命错误：本手 DB 已删；客户端应提示并回首页，勿再按本事件恢复桌上状态。人数不足关房见 `game-room-closed`。 */
export type WsGameInvalidatedData = {
  roomId: number
  matchId: number
  reason: string
  source: 'engine_error'
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

export type WsOnlineStatus = 'online' | 'offline'

export type WsPlayerQuitGameData = {
  roomId: number
  userId: number
  /**
   * 单播给 `userId` 本人：用于被踢/补码失败等退场提示。
   * 他人以 `game-table-roster` 为准同步牌桌名单。
   */
  reason?: 'quit' | 'zero_balance_no_topup' | 'offline_grace'
}

/** 对局内玩家连接状态变化（仅用于展示/倒计时策略，不代表离桌）。 */
export type WsPlayerStatusChangeData = {
  roomId: number
  userId: number
  status: WsOnlineStatus
}

/** 玩家已提交退出（用于客户端提示，不代表已从牌桌摘除）。 */
export type WsPlayerLeftGameData = {
  roomId: number
  userId: number
  name: string
  avatarKey: string
}

export type WsGameRoomClosedData = {
  roomId: number
  reason: 'insufficient_players'
}

export type WsPlayersPostedBigBlindData = {
  roomId: number
  matchId: number | null
  /** 与 `posts[].userId` 一致；服务端据此 `resyncGameRoomSeatPresence`。 */
  seatedUserIds: number[]
  /** 与 Core `PostedJoiningBigBlinds.payload.posts` 对齐的一次性批量（含单元素 `PostBigBlind`）。 */
  posts: Array<{
    userId: number
    amount: number
    /** 桌级大盲规定额；短码时 `amount` 可能更小。 */
    requested: number
    balance: number
    totalBetAmount: number
    currentStageBetAmount: number
  }>
  pool: number
}

/** 在座行：含本手「已提交离场、环上尚未摘除」的 `leavePending`（与 HTTP `fetchCurrentGameState.seats` 可对齐）。 */
export type WsGameTableRosterSeat = WsPlayerProfileItem & {
  leavePending?: boolean
  onlineStatus?: WsOnlineStatus
}

/** 观战行：仅 profile + 连接态，不含 `leavePending` 语义。 */
export type WsGameTableRosterWatcher = WsPlayerProfileItem & {
  onlineStatus?: WsOnlineStatus
}

/**
 * 全房牌桌名单快照：当前 on-set（`seats`）与 hang（`watchers`）的展示权威。
 * 与 `player-left-game` 配合：全房名单以本事件为准；`player-quit-game` 仅单播离场本人（见该类型注释）。
 */
export type WsGameTableRosterData = {
  roomId: number
  /** 单调递增，便于客户端检测丢序并触发 `fetchCurrentGameState` 纠偏。 */
  rosterSeq: number
  seats: WsGameTableRosterSeat[]
  watchers: WsGameTableRosterWatcher[]
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
  /** 服务端当前 replay 世代；进程重启会变化。 */
  replayEpoch: string
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
  'player-status-change': WsPlayerStatusChangeData
  'player-left-game': WsPlayerLeftGameData
  'player-quit-game': WsPlayerQuitGameData
  'game-room-closed': WsGameRoomClosedData
  'players-posted-big-blind': WsPlayersPostedBigBlindData
  'game-table-roster': WsGameTableRosterData
  'player-hand-voluntarily-shown': WsPlayerHandVoluntarilyShownData
  'game-room-replay': WsGameRoomReplayData
}

export type WsEventType = keyof WsEventDataMap

export type WsMessage<T extends WsEventType = WsEventType> = {
  type: T
  data: WsEventDataMap[T]
  /**
   * `/game` 全房广播序号（仅 replayable 事件携带）：
   * - 同一 `replayEpoch` 内单调递增；
   * - 可用于客户端幂等去重（忽略 `seq <= lastHandledSeq`）；
   * - room-list / waiting-room 事件通常不带该字段。
   */
  seq?: number
  /**
   * `/game` replay 世代标识（进程重启后变化），用于和 `seq` 组合判断序列是否可比较。
   */
  replayEpoch?: string
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
  tableBackgroundKey: string
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
  /** presence 语义态，便于客户端做三态处理。 */
  state: 'online' | 'offline' | 'pending'
  /** 房间内 presence 事件序号（单调递增）。 */
  seq?: number
}

export type WsWaitingRoomPresenceSnapshotData = {
  roomId: number
  /** 快照对应的最新 presence 事件序号。 */
  seq: number
  members: Array<{
    userId: number
    state: 'online' | 'offline' | 'pending'
  }>
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
    tableBackgroundKey: string
  }
  initialChips: number
  thinkingTime: number
  lowestBetAmount: number
  tableType: 'quick' | 'standard' | 'deep' | 'custom'
  sevenTwoBonusEnabled: boolean
  createdAt: string
  memberCount: number
  playSession: WsRoomListPlaySession
}

export type RoomWsEventDataMap = {
  'waiting-room-member-joined': WsWaitingRoomMemberJoinedData
  'waiting-room-member-left': WsWaitingRoomMemberLeftData
  'waiting-room-member-presence': WsWaitingRoomMemberPresenceData
  'waiting-room-presence-snapshot': WsWaitingRoomPresenceSnapshotData
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
