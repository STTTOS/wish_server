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

export type WsPlayerActionRequiredData = {
  matchId: number
  userId: number
  /**
   * 本条 WS 实际发出时刻（unix ms）。若服务端延迟推送 action-required，会与引擎开始计时的时刻不同；
   * 剩余思考时间请用 deadlineAt - 本地当前时间（可结合 serverNow 做时钟偏差估计），不要用「满额思考时长」从零开始减。
   */
  serverNow: number
  /** 与引擎一致的思考截止绝对时间（unix ms），在 onPreAction 触发时确定 */
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
  // 此局总下注, 每局清空
  totalBetAmount: number
  // 当前阶段总下注, 每一轮清空
  currentStageBetAmount: number
  balance: number
}

export type WsGameStageChangedData = {
  matchId: number
  stage: StageEnum
  pokesToReveal: Poke[]
}

/** game-end.matchOverview：房间内累计（含已离开但曾有战绩/补码的用户） */
export type WsMatchOverviewWagerItem = {
  userId: number
  /** 本房累计 `Σ playerMatchRecord.wager` 取整归零后的桌上输赢净额（零和）；与 chipTopUp 无关 */
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
  // rank: number
  isAllIn: boolean
  isFold: boolean
  /** 与 showMyHandPokes 一致：已弃牌，或独收池（恰好一名未弃牌）时在坐者均可；局间/运行时仍以 HTTP 为准 */
  canVoluntaryShowHand: boolean
  handPokes: Poke[]
  rankCategory?: RankCategory
  /** 与 handPokes 同规则：他人视角下弃牌或未到摊牌时不下发 */
  rankStrength?: number
}

export type WsGameEndData = {
  matchId: number
  settleList: WsGameEndSettleItem[]
  /** 房间维度总览；与本手 settleList 独立 */
  matchOverview: WsMatchOverview
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
  /** 推送时刻起算的倒计时终点（unix ms）；抵达后分配角色并发牌链路 */
  endsAt: number
  /** 推送时刻起算，坐席锁定、房间 `in_hand`（unix ms） */
  lockAt: number
  /** 服务端生成该消息的 unix ms；与 endsAt/lockAt 同基准 */
  serverNow: number
}

export type WsNextHandCountdownCancelledData = {
  roomId: number
}

/** 局间补码成功：全桌同步该玩家最新余额与本次补入数量（来自房间 initialChips） */
export type WsPlayerChipTopUpData = {
  roomId: number
  userId: number
  /** 服务端取本房最近已结束的 Match.id */
  afterMatchId: number
  /** 本次补入筹码（服务端从库读取，与 Room.initialChips 一致） */
  topUpAmount: number
  balanceAfter: number
}

/** 牌桌内置语音（快捷音效）：同房间 /game 订阅者广播 */
export type WsPlayerBuiltInVoiceData = {
  userId: number
  voiceName: string
}

/** 局间 HTTP 退出对局成功：同房间 /game 订阅者广播 */
export type WsPlayerQuitGameData = {
  roomId: number
  userId: number
}

/** 局间主动亮牌：同房间 /game 订阅者广播（每人每 match 仅首次推送） */
export type WsPlayerHandVoluntarilyShownData = {
  roomId: number
  matchId: number
  userId: number
  handPokes: Poke[]
  /** 本手结算落库的牌型；未形成牌型或未计算时为 null */
  rankCategory: RankCategory | null
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
  'player-chip-top-up': WsPlayerChipTopUpData
  'player-built-in-voice': WsPlayerBuiltInVoiceData
  'player-quit-game': WsPlayerQuitGameData
  'player-hand-voluntarily-shown': WsPlayerHandVoluntarilyShownData
}

export type WsEventType = keyof WsEventDataMap

export type WsMessage<T extends WsEventType = WsEventType> = {
  type: T
  data: WsEventDataMap[T]
}
