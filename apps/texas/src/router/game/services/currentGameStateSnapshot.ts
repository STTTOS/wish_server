import type { Texas, Stage, HandLifecycle } from 'texas-poker-core'

import { type RankCategory } from 'texas-poker-core'

import { getCurrentMatchIdWithFallback } from './currentMatch'
import { getLatestGameRoomSeq } from '../../../SockeServer/gameRoomWsReplayBuffer'
import { getNextHandCountdownSnapshot } from '../../../gameRuntime/nextHandCountdown'
import { getScheduledPlayerTurnDeadline } from './texasDomain/playerTurnTimeoutScheduler'

export type FetchCurrentGameStatePayload = {
  roomGameStatus: string
  playersOnSeat: Array<{
    userInfo: { id: number; name: string }
    role: ReturnType<NonNullable<import('texas-poker-core').Player['getRole']>>
    actionIndex: number
    isFold: boolean
    isAllIn: boolean
    balance: number
    currentStageTotalAmount: number
    totalBetAmount: number
    action: import('texas-poker-core').Player['getAction'] extends () => infer A
      ? A
      : never
    onlineStatus: import('texas-poker-core').OnlineStatus
    rankCategory?: RankCategory
    rankStrength: number
  }>
  playersOnWatch: Array<{
    userInfo: { id: number; name: string }
    onlineStatus: import('texas-poker-core').OnlineStatus
  }>
  matchInfo: {
    matchId: number | null
    roomId: number
    /** Core `HandLifecycle`；与旧字段 `status` 同值 */
    handLifecycle: HandLifecycle
    /** @deprecated 请改用 `handLifecycle` */
    status: HandLifecycle
    stage: Stage
    pool: number
    commonPokes: import('texas-poker-core').Poke[]
  }
  activePlayerInfo: {
    userInfo: { id: number; name: string }
    deadlineAt: number | null
    serverNow?: number
    allowedActions: import('texas-poker-core').ActionType[]
    restrict?: { min: number; max: number }
  } | null
  /** 与 `player-hand-dealt` 对齐；非本手在桌或未发牌时为 `[]` */
  myHandPokes: import('texas-poker-core').Poke[]
  /** 与 WS `next-hand-countdown-*` 对齐 */
  nextHandCountdown: ReturnType<typeof getNextHandCountdownSnapshot>
  latestWsSeq: number
}

/**
 * 组装 `POST /game/fetchCurrentGameState` 载荷：对齐 Core 读模型与全房 WS 事件所需字段。
 */
export async function buildFetchCurrentGameStatePayload(input: {
  texas: Texas
  roomId: number
  userId: number
  roomGameStatus: string
}): Promise<FetchCurrentGameStatePayload> {
  const { texas, roomId, userId, roomGameStatus } = input
  const roomKey = String(roomId)
  const handLifecycle = texas.controller.status
  const inHand = handLifecycle === 'in_hand'

  const playersOnSeat = texas.dealer
    .getPlayersByActionSequence()
    .map((player, actionIndex) => {
      const st = player.getStatus()
      return {
        userInfo: player.getUserInfo(),
        role: player.getRole(),
        actionIndex,
        isFold: st === 'out',
        isAllIn: st === 'allIn',
        balance: player.balance,
        currentStageTotalAmount: player.currentStageTotalAmount,
        totalBetAmount: player.totalBetAmount,
        action: player.getAction(),
        onlineStatus: player.onlineStatus,
        rankCategory: player.rankCategory,
        rankStrength: player.rankStrength
      }
    })

  const playersOnWatch = texas.room
    .getPlayersBySeatStatus('hang')
    .map((player) => ({
      userInfo: player.getUserInfo(),
      onlineStatus: player.onlineStatus
    }))

  const currentMatchId = await getCurrentMatchIdWithFallback(roomId)
  const commonPokes = texas.controller.getRevealedPokes()
  const active = texas.controller.activePlayer
  const handId = texas.controller.currentHandId

  const pendingTurn = getScheduledPlayerTurnDeadline(roomKey)
  const serverNow = Date.now()

  let activePlayerInfo: FetchCurrentGameStatePayload['activePlayerInfo'] = null
  if (active) {
    const uid = active.getUserInfo().id
    const turnMatchesActive =
      pendingTurn != null &&
      pendingTurn.userId === uid &&
      handId != null &&
      pendingTurn.handId === handId

    activePlayerInfo = {
      userInfo: active.getUserInfo(),
      deadlineAt: turnMatchesActive ? pendingTurn.deadlineAt : null,
      serverNow: turnMatchesActive ? serverNow : undefined,
      allowedActions: [...active.getAllowedActions()],
      restrict: active.getRestrict()
    }
  }

  const self = texas.dealer.getById(userId)
  const myHandPokes =
    inHand && self && texas.dealer.has(self) ? self.getHandPokes() : []

  return {
    roomGameStatus,
    playersOnSeat,
    playersOnWatch,
    matchInfo: {
      matchId: currentMatchId,
      roomId: Number(roomId),
      handLifecycle,
      status: handLifecycle,
      stage: texas.controller.stage,
      pool: texas.pool.totalAmount,
      commonPokes
    },
    activePlayerInfo,
    myHandPokes: [...myHandPokes],
    nextHandCountdown: getNextHandCountdownSnapshot(roomId),
    latestWsSeq: getLatestGameRoomSeq(roomKey)
  }
}
