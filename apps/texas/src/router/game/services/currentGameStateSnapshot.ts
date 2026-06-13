import type { Texas, Stage, Player, HandLifecycle } from 'texas-poker-core'
import type {
  WsGameEndData,
  WsGameTableRosterData,
  WsGameTableRosterSeat,
  WsGameTableRosterWatcher,
  WsRunoutHandsRevealedData
} from '@wishufree/texas-ws-contract'

import { type RankCategory } from 'texas-poker-core'

import prisma from '../../../models'
import { gameRuntimeRegistry } from './runtimeRegistry'
import { getCurrentMatchIdWithFallback } from './currentMatch'
import { buildLastGameEndForViewer } from './lastGameEndSnapshot'
import { getNextHandCountdownSnapshot } from '../../../gameRuntime/nextHandCountdown'
import { getScheduledPlayerTurnDeadline } from './texasDomain/playerTurnTimeoutScheduler'
import {
  getLatestGameRoomSeq,
  getGameRoomReplayEpoch
} from '../../../SockeServer/gameRoomWsReplayBuffer'

export type FetchCurrentGameStatePayload = {
  roomGameStatus: string
  /** 与 WS `game-table-roster.seats` 字段名对齐；含本手中途离场未摘座 `leavePending`。 */
  seats: Array<{
    userInfo: { id: number; name: string }
    leavePending: boolean
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
    onlineStatus: 'online' | 'offline'
    rankCategory?: RankCategory
    rankStrength: number
  }>
  /** 与 WS `game-table-roster.watchers` 字段名对齐。 */
  watchers: Array<{
    userInfo: { id: number; name: string }
    onlineStatus: 'online' | 'offline'
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
  latestWsReplayEpoch: string
  myTopUpState: {
    roomDefaultBuyIn: number
    autoTopUpEnabled: boolean
  }
  /** 局间：与 WS `game-end` 同形，按请求用户掩码 settleList */
  lastGameEnd: WsGameEndData | null
  /** 本手跑马路已亮底牌（不含请求用户本人）；`in_hand` 且已触发 runout 时有值 */
  runoutHandsRevealed: WsRunoutHandsRevealedData | null
}

async function loadUserProfilesByIds(userIds: number[]): Promise<
  Map<
    number,
    {
      userId: number
      name: string
      avatarUrl: string | null
      avatarKey: string
      pokerBackgroundKey: string
    }
  >
> {
  const unique = [
    ...new Set(userIds.filter((id) => Number.isFinite(id) && id > 0))
  ]
  if (unique.length === 0) {
    return new Map()
  }
  const rows = await prisma.user.findMany({
    where: { id: { in: unique } },
    select: {
      id: true,
      name: true,
      avatarUrl: true,
      avatarKey: true,
      pokerBackgroundKey: true
    }
  })
  return new Map(
    rows.map((u) => [
      u.id,
      {
        userId: u.id,
        name: u.name || `玩家${u.id}`,
        avatarUrl: u.avatarUrl ?? null,
        avatarKey: u.avatarKey || 'cartoon/default',
        pokerBackgroundKey: u.pokerBackgroundKey || 'default'
      }
    ])
  )
}

async function loadRoomMemberUserIds(roomId: number): Promise<Set<number>> {
  const rows = await prisma.roomMember.findMany({
    where: { roomId },
    select: { userId: true }
  })
  return new Set(rows.map((row) => row.userId))
}

/** 与 Core `on-set` 对齐；本手中途离场者在摘环前仍计入 `seats`（配合 `leavePending`）。 */
function resolveRosterSeatPlayers(texas: Texas): Player[] {
  return texas.room.getPlayersBySeatStatus('on-set')
}

/** 观战席仅展示仍在房间成员表中的玩家；已 HTTP 退出的 `hang` 残留不计入观战人数。 */
function resolveRosterWatcherPlayers(input: {
  texas: Texas
  roomMemberUserIds: ReadonlySet<number>
}): Player[] {
  const { texas, roomMemberUserIds } = input
  return texas.room
    .getPlayersBySeatStatus('hang')
    .filter((player) => roomMemberUserIds.has(player.getUserInfo().id))
}

function fallbackProfile(
  profileById: Map<
    number,
    {
      userId: number
      name: string
      avatarUrl: string | null
      avatarKey: string
      pokerBackgroundKey: string
    }
  >,
  userId: number,
  nameFromEngine: string
) {
  return (
    profileById.get(userId) ?? {
      userId,
      name: nameFromEngine || `玩家${userId}`,
      avatarUrl: null as string | null,
      avatarKey: 'cartoon/default',
      pokerBackgroundKey: 'default'
    }
  )
}

/**
 * 组装 `game-table-roster` 与 HTTP 快照共用的「名单 + profile」读模型（`rosterSeq` 由调用方写入 payload）。
 */
export async function buildGameTableRosterData(input: {
  texas: Texas
  roomId: number
  roomKey: string
  rosterSeq: number
}): Promise<WsGameTableRosterData> {
  const { texas, roomId, roomKey, rosterSeq } = input
  const roomMemberUserIds = await loadRoomMemberUserIds(roomId)
  const seatPlayers = resolveRosterSeatPlayers(texas)
  const hangPlayers = resolveRosterWatcherPlayers({ texas, roomMemberUserIds })
  const ids: number[] = []
  for (const p of seatPlayers) ids.push(p.getUserInfo().id)
  for (const p of hangPlayers) ids.push(p.getUserInfo().id)
  const profileById = await loadUserProfilesByIds(ids)

  const seats: WsGameTableRosterSeat[] = seatPlayers.map((player) => {
    const uid = player.getUserInfo().id
    const prof = fallbackProfile(profileById, uid, player.getUserInfo().name)
    return {
      ...prof,
      leavePending: gameRuntimeRegistry.hasQueuedLeave(roomKey, uid),
      onlineStatus: gameRuntimeRegistry.getUserConnectionStatus(roomKey, uid)
    }
  })

  const watchers: WsGameTableRosterWatcher[] = hangPlayers.map((player) => {
    const uid = player.getUserInfo().id
    const prof = fallbackProfile(profileById, uid, player.getUserInfo().name)
    return {
      ...prof,
      onlineStatus: gameRuntimeRegistry.getUserConnectionStatus(roomKey, uid)
    }
  })

  return { roomId, rosterSeq, seats, watchers }
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

  const roomMemberUserIds = await loadRoomMemberUserIds(roomId)
  const seatPlayers = resolveRosterSeatPlayers(texas)
  const hangPlayers = resolveRosterWatcherPlayers({ texas, roomMemberUserIds })
  const actionIndexByUserId = new Map(
    texas.dealer
      .getPlayersByActionSequence()
      .map((player, actionIndex) => [player.getUserInfo().id, actionIndex])
  )

  const seats = seatPlayers.map((player) => {
    const st = player.getStatus()
    const uid = player.getUserInfo().id
    return {
      userInfo: player.getUserInfo(),
      leavePending: gameRuntimeRegistry.hasQueuedLeave(roomKey, uid),
      role: player.getRole(),
      actionIndex: actionIndexByUserId.get(uid) ?? 0,
      isFold: st === 'out',
      isAllIn: st === 'allIn',
      balance: player.balance,
      currentStageTotalAmount: player.currentStageTotalAmount,
      totalBetAmount: player.totalBetAmount,
      action: player.getAction(),
      onlineStatus: gameRuntimeRegistry.getUserConnectionStatus(roomKey, uid),
      rankCategory: player.rankCategory,
      rankStrength: player.rankStrength
    }
  })

  const watchers = hangPlayers.map((player) => ({
    userInfo: player.getUserInfo(),
    onlineStatus: gameRuntimeRegistry.getUserConnectionStatus(
      roomKey,
      player.getUserInfo().id
    )
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
  const runtime = gameRuntimeRegistry.getOrThrow(roomKey)
  const roomDefaultBuyIn = Math.max(0, Number(runtime.roomInfo.initialChips))

  let lastGameEnd: WsGameEndData | null = null
  let runoutHandsRevealed: WsRunoutHandsRevealedData | null = null

  if (currentMatchId != null) {
    if (handLifecycle === 'in_hand') {
      const cached = gameRuntimeRegistry.getRunoutHandsRevealed(roomKey)
      if (cached != null && cached.matchId === currentMatchId) {
        runoutHandsRevealed = {
          matchId: cached.matchId,
          revealedHands: (cached.revealedHands ?? []).filter(
            (row) => row.userId !== userId
          )
        }
      }
    } else if (
      handLifecycle === 'between_hands' ||
      handLifecycle === 'idle' ||
      roomGameStatus === 'between_hands'
    ) {
      lastGameEnd = await buildLastGameEndForViewer({
        roomId,
        matchId: currentMatchId,
        viewerUserId: userId
      })
    }
  }

  return {
    roomGameStatus,
    seats,
    watchers,
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
    latestWsSeq: getLatestGameRoomSeq(roomKey),
    latestWsReplayEpoch: getGameRoomReplayEpoch(),
    myTopUpState: {
      roomDefaultBuyIn,
      autoTopUpEnabled: gameRuntimeRegistry.isAutoTopUpEnabled(roomKey, userId)
    },
    lastGameEnd,
    runoutHandsRevealed
  }
}
