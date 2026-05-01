import type { Player } from 'texas-poker-core'
import type { ActionType } from '@prisma/texas-client'
import type { TexasEventContext } from './texasEventContext'
import type { WsMatchOverview } from '@wishufree/texas-ws-contract'

import { Prisma } from '@prisma/texas-client'
import {
  TexasError,
  isFatalTexasErrorCode,
  type TexasDomainEvent
} from 'texas-poker-core'

import { logger } from '../../../../logger'
import { gameRuntimeRegistry } from '../runtimeRegistry'
import { appendMatchDomainEventTape } from './matchDomainEventTape'
import { CUSTOM_27O_REWARD_TIERS } from '../../../../constants/game'
import { gameRuntimeConfig } from '../../../../utils/gameRuntimeConfig'
import { fetchMatchOverviewForRoom } from '../matchOverviewAggregation'
import { handleFatalTexasEngineError } from './handleFatalTexasEngineError'
import { maybeStartNextHandCountdown } from '../../../../gameRuntime/nextHandCountdown'
import {
  clearPlayerTurnTimeout,
  schedulePlayerTurnTimeout
} from './playerTurnTimeoutScheduler'
import prisma, {
  match,
  betRecord,
  room as roomModel,
  matchStageTimeRecord
} from '../../../../models'
import {
  cancelNextHandCountdown,
  unregisterNextHandHooks
} from '../../../../gameRuntime/nextHandCountdown'

function sleep(ms: number): Promise<void> {
  return ms <= 0 ? Promise.resolve() : new Promise((r) => setTimeout(r, ms))
}

const OFFLINE_TURN_THINKING_TIME_MS = 5000
const OFFLINE_RECONNECT_GRACE_HANDS = 2

function isSevenTwoOffsuit(handPokes: string[]): boolean {
  if (handPokes.length !== 2) return false
  const [a, b] = handPokes
  if (a.length < 2 || b.length < 2) return false
  const suitA = a[0]
  const rankA = a.slice(1)
  const suitB = b[0]
  const rankB = b.slice(1)
  if (suitA === suitB) return false
  return (rankA === '2' && rankB === '7') || (rankA === '7' && rankB === '2')
}

function resolve27oRewardChips(initialChips: number, bb: number): number {
  if (bb <= 0) return 0
  const bbDepth = initialChips / bb
  for (const tier of CUSTOM_27O_REWARD_TIERS) {
    if (bbDepth >= tier.minBbDepth) return tier.rewardBb * bb
  }
  return (
    CUSTOM_27O_REWARD_TIERS[CUSTOM_27O_REWARD_TIERS.length - 1]!.rewardBb * bb
  )
}

function applySevenTwoOffsuitBonusAtGameEnd(params: {
  seatedPlayers: Player[]
  rewardChipsPerPayer: number
  outcome: 'showdown' | 'fold_win'
}): {
  paidByUserId: Map<number, number>
  receivedByUserId: Map<number, number>
} {
  const paidByUserId = new Map<number, number>()
  const receivedByUserId = new Map<number, number>()
  const rewardChips = Math.max(0, Math.floor(params.rewardChipsPerPayer))
  if (rewardChips <= 0) return { paidByUserId, receivedByUserId }

  const activePlayers = params.seatedPlayers.filter(
    (player) => player.getStatus() !== 'out'
  )
  let winners: Player[] = []
  if (params.outcome === 'fold_win') {
    const [soleWinner] = activePlayers
    if (
      activePlayers.length === 1 &&
      soleWinner &&
      isSevenTwoOffsuit(soleWinner.getHandPokes())
    ) {
      winners = [soleWinner]
    }
  } else {
    const maxRankStrength = activePlayers.reduce(
      (max, player) => Math.max(max, player.rankStrength),
      Number.NEGATIVE_INFINITY
    )
    winners = activePlayers.filter(
      (player) =>
        player.rankStrength === maxRankStrength &&
        isSevenTwoOffsuit(player.getHandPokes())
    )
  }
  if (winners.length === 0) return { paidByUserId, receivedByUserId }

  const winnerIdSet = new Set(winners.map((x) => x.getUserInfo().id))
  const payers = params.seatedPlayers.filter(
    (player) => !winnerIdSet.has(player.getUserInfo().id)
  )
  if (payers.length === 0) return { paidByUserId, receivedByUserId }

  let collected = 0
  for (const payer of payers) {
    const userId = payer.getUserInfo().id
    const paid = Math.min(rewardChips, Math.max(0, Math.floor(payer.balance)))
    if (paid <= 0) continue
    payer.balance -= paid
    payer.wager -= paid
    collected += paid
    paidByUserId.set(userId, (paidByUserId.get(userId) ?? 0) + paid)
  }
  if (collected <= 0) return { paidByUserId, receivedByUserId }

  const baseShare = Math.floor(collected / winners.length)
  const remainder = collected % winners.length
  for (const winner of winners) {
    const userId = winner.getUserInfo().id
    winner.balance += baseShare
    winner.wager += baseShare
    receivedByUserId.set(
      userId,
      (receivedByUserId.get(userId) ?? 0) + baseShare
    )
  }
  if (remainder > 0) {
    const luckyIdx = Math.floor(Math.random() * winners.length)
    const lucky = winners[luckyIdx]!
    const luckyUserId = lucky.getUserInfo().id
    lucky.balance += remainder
    lucky.wager += remainder
    receivedByUserId.set(
      luckyUserId,
      (receivedByUserId.get(luckyUserId) ?? 0) + remainder
    )
  }
  return { paidByUserId, receivedByUserId }
}

/**
 * 结算「离线在座玩家宽限策略」。
 *
 * 调用时机：
 * - 仅在每手 HandEnded 结尾调用一次（不在手内调用），按「手」累计离线宽限计数。
 *
 * 规则：
 * - 只统计 `on-set` 玩家（观战不参与对局离线治理）。
 * - 玩家在线则清零其离线手数；离线则 +1。
 * - 达到阈值（当前为 2 手）后：从 roomMember 与桌上移除，并广播 `player-quit-game`。
 * - 若移除后房间无成员：关闭房间并销毁运行时。
 *
 * 返回值：
 * - `{ roomClosed: true }` 表示已关闭房间，调用方应立即结束后续开新手流程。
 */
async function settleOfflineSeatGrace(
  ctx: TexasEventContext
): Promise<{ roomClosed: boolean }> {
  const { texas, roomId, roomKey, wsGateway } = ctx
  const onSeatPlayers = texas.room.getPlayersBySeatStatus('on-set')
  if (onSeatPlayers.length === 0) return { roomClosed: false }

  const toKick: number[] = []
  for (const player of onSeatPlayers) {
    const uid = player.getUserInfo().id
    if (gameRuntimeRegistry.isUserOffline(roomKey, uid)) {
      const handCount = gameRuntimeRegistry.bumpOfflineHandCount(roomKey, uid)
      if (handCount >= OFFLINE_RECONNECT_GRACE_HANDS) {
        toKick.push(uid)
      }
    } else {
      gameRuntimeRegistry.resetOfflineHandCount(roomKey, uid)
    }
  }

  if (toKick.length === 0) return { roomClosed: false }

  const txResult = await prisma.$transaction(async (tx) => {
    await tx.roomMember.deleteMany({
      where: { roomId, userId: { in: toKick } }
    })
    const memberCount = await tx.roomMember.count({ where: { roomId } })
    if (memberCount === 0) {
      await tx.room.update({
        where: { id: roomId },
        data: {
          deletedAt: new Date(),
          activeOwnerId: null,
          activeCode: null
        }
      })
    }
    return { memberCount }
  })

  for (const uid of toKick) {
    gameRuntimeRegistry.clearConnectionTracking(roomKey, uid)
    gameRuntimeRegistry.cancelQueuedLeave(roomKey, uid)
    try {
      if (texas.room.has(uid)) texas.room.removeById(uid)
    } catch (e) {
      logger.warn(
        `[offline-grace] removeById failed roomId=${roomId} userId=${uid}`,
        e
      )
    }
    wsGateway.notifyPlayerQuitGame(
      roomKey,
      { roomId, userId: uid },
      { excludeUserId: uid }
    )
  }

  if (txResult.memberCount === 0) {
    cancelNextHandCountdown(roomId)
    unregisterNextHandHooks(roomId)
    wsGateway.notifyGameRoomClosed(roomKey, {
      roomId,
      reason: 'insufficient_players'
    })
    wsGateway.broadcastRoomListRoomDeleted(roomId)
    gameRuntimeRegistry.destroyRuntime(roomKey)
    return { roomClosed: true }
  }

  wsGateway.broadcastRoomListMemberCountChanged({
    roomId,
    memberCount: txResult.memberCount
  })
  return { roomClosed: false }
}

/** Append-only 领域事件磁带，供回放；`createdAt` 由 DB 默认即可推算思考间隔 */
async function appendMatchDomainEventTapeFromCtx(
  ctx: TexasEventContext,
  e: TexasDomainEvent
): Promise<void> {
  const matchId = ctx.getRuntime().currentMatchId
  if (matchId == null) return
  try {
    await appendMatchDomainEventTape({
      matchId,
      roomId: ctx.roomId,
      event: e
    })
  } catch (err) {
    logger.warn('[MatchDomainEvent] append failed', err)
  }
}

async function interpretTexasDomainEvents(
  ctx: TexasEventContext,
  events: readonly TexasDomainEvent[]
): Promise<void> {
  for (const ev of events) {
    await processTexasDomainEvent(ctx, ev)
  }
}

function rankSignatureForDb(player: Player): string | null {
  const sig = player.rankSignature
  if (sig == null) return null
  if (typeof sig === 'string') return sig
  return JSON.stringify(sig)
}

async function flushEventsAfterSettle(ctx: TexasEventContext): Promise<void> {
  for (;;) {
    const batch = ctx.texas.drainDomainEvents()
    if (batch.length === 0) break
    for (const ev of batch) {
      if (ev.type === 'HandEnded') {
        logger.warn('[texas domain] ignoring nested HandEnded after settle')
        continue
      }
      await processTexasDomainEvent(ctx, ev)
    }
  }
}

async function handleHandEnded(
  ctx: TexasEventContext,
  e: Extract<TexasDomainEvent, { type: 'HandEnded' }>
): Promise<void> {
  const { texas, roomId, roomKey, wsGateway, getRuntime } = ctx
  const p = e.payload

  clearPlayerTurnTimeout(roomKey)

  try {
    const gameEndAt = new Date()
    const currentMatchId = getRuntime().currentMatchId
    if (currentMatchId == null) {
      logger.error('HandEnded skipped: currentMatchId is null')
      return
    }

    // 仍有一条街的 endAt 未写（例如跑马路未为后续亮牌街建表）：只闭合「最新一条」仍为 null 的时间轴
    const openStageRow = await matchStageTimeRecord.findFirst({
      where: { matchId: currentMatchId, endAt: null },
      orderBy: [{ startAt: 'desc' }, { id: 'desc' }]
    })
    if (openStageRow) {
      await matchStageTimeRecord.update({
        where: { id: openStageRow.id },
        data: { endAt: gameEndAt }
      })
    }

    const settleEvents = texas.settle()
    await interpretTexasDomainEvents(ctx, settleEvents)
    await flushEventsAfterSettle(ctx)

    const seated = texas.room.getPlayersBySeatStatus('on-set')
    const roomRule = await roomModel.findUnique({
      where: { id: roomId },
      select: {
        sevenTwoBonusEnabled: true,
        initialChips: true,
        lowestBetAmount: true
      }
    })
    let sevenTwoBonusByUserId: {
      paidByUserId: Map<number, number>
      receivedByUserId: Map<number, number>
    } = {
      paidByUserId: new Map<number, number>(),
      receivedByUserId: new Map<number, number>()
    }
    if (roomRule?.sevenTwoBonusEnabled) {
      const rewardChips = resolve27oRewardChips(
        roomRule.initialChips,
        roomRule.lowestBetAmount
      )
      sevenTwoBonusByUserId = applySevenTwoOffsuitBonusAtGameEnd({
        seatedPlayers: seated,
        rewardChipsPerPayer: rewardChips,
        outcome: p.outcome
      })
    }
    const sevenTwoAutoShownUserIds = new Set<number>(
      Array.from(sevenTwoBonusByUserId.receivedByUserId.keys())
    )
    const sortedSeated = [...seated].sort((a, b) => {
      const aFold = a.getStatus() === 'out'
      const bFold = b.getStatus() === 'out'
      if (aFold !== bFold) return aFold ? 1 : -1
      if (aFold && bFold) return b.wager - a.wager
      if (b.rankStrength !== a.rankStrength) {
        return b.rankStrength - a.rankStrength
      }
      return b.wager - a.wager
    })

    const unfoldedOnSetCount = seated.filter(
      (x) => x.getStatus() !== 'out'
    ).length

    const seatedUserIds = sortedSeated.map((pl) => pl.getUserInfo().id)
    const seatedUsers =
      seatedUserIds.length > 0
        ? await prisma.user.findMany({
            where: { id: { in: seatedUserIds } },
            select: {
              id: true,
              name: true,
              avatarUrl: true,
              avatarKey: true,
              pokerBackgroundKey: true
            }
          })
        : []
    const seatedProfileByUserId = new Map(
      seatedUsers.map((u) => [
        u.id,
        {
          name: u.name,
          avatarUrl: u.avatarUrl,
          avatarKey: u.avatarKey,
          pokerBackgroundKey: u.pokerBackgroundKey
        }
      ])
    )

    const buildSettleListForViewer = (viewerUserId: number) =>
      sortedSeated.map((pl) => {
        const userId = pl.getUserInfo().id
        const profile = seatedProfileByUserId.get(userId)
        const isFold = pl.getStatus() === 'out'
        let handPokes = pl.getHandPokes()
        const hideHoleFromViewer =
          viewerUserId !== userId && (isFold || !p.showHandPokes)
        if (hideHoleFromViewer) {
          handPokes = []
        }
        return {
          userId,
          name: profile?.name ?? pl.getUserInfo().name ?? `玩家${userId}`,
          avatarUrl: profile?.avatarUrl ?? null,
          avatarKey: profile?.avatarKey ?? 'cartoon/default',
          pokerBackgroundKey: profile?.pokerBackgroundKey ?? null,
          balance: pl.balance,
          wager: pl.wager,
          sevenTwoBonusPaid:
            sevenTwoBonusByUserId.paidByUserId.get(userId) ?? 0,
          sevenTwoBonusReceived:
            sevenTwoBonusByUserId.receivedByUserId.get(userId) ?? 0,
          isAllIn: pl.getStatus() === 'allIn',
          isFold,
          canVoluntaryShowHand:
            !sevenTwoAutoShownUserIds.has(userId) &&
            (isFold || unfoldedOnSetCount === 1),
          handPokes,
          ...(hideHoleFromViewer
            ? {
                rankStrength: 0,
                rankCategory: undefined
              }
            : {
                rankStrength: pl.rankStrength,
                rankCategory: pl.rankCategory
              })
        }
      })

    const totalBetAmount = texas.pool.totalAmount
    await match.update({
      where: { id: currentMatchId },
      data: {
        commonPokes: p.pokesRevealed,
        bestRankCategory: p.bestRankCategory,
        endedAt: gameEndAt,
        boardThroughStage: p.endStage,
        bestPokes: p.bestPokes,
        totalBetAmount
      }
    })

    await prisma.$transaction(async (tx) => {
      for (const pl of seated) {
        const userId = pl.getUserInfo().id
        const isFold = pl.getStatus() === 'out'
        const isAllIn = pl.getStatus() === 'allIn'
        const settleFields = {
          wager: pl.wager,
          rankCategory: pl.rankCategory ?? null,
          rankSignature: rankSignatureForDb(pl),
          rankStrength: pl.rankStrength,
          totalBetAmount: Math.round(pl.totalBetAmount ?? 0),
          isFold,
          isAllIn,
          balanceAfterHand: Math.round(pl.balance),
          sevenTwoBonusPaid:
            sevenTwoBonusByUserId.paidByUserId.get(userId) ?? 0,
          sevenTwoBonusReceived:
            sevenTwoBonusByUserId.receivedByUserId.get(userId) ?? 0,
          voluntaryShowHandAt: sevenTwoAutoShownUserIds.has(userId)
            ? gameEndAt
            : null
        }
        try {
          await tx.playerMatchRecord.update({
            where: {
              matchId_userId: {
                matchId: currentMatchId,
                userId
              }
            },
            data: settleFields
          })
        } catch (err) {
          if (
            err instanceof Prisma.PrismaClientKnownRequestError &&
            err.code === 'P2025'
          ) {
            logger.error(
              `[HandEnded] playerMatchRecord missing matchId=${currentMatchId} userId=${userId}`
            )
          } else {
            throw err
          }
        }
      }
    })

    let matchOverview: WsMatchOverview = {
      wagerList: [],
      billList: [],
      playerProfiles: []
    }
    try {
      matchOverview = await fetchMatchOverviewForRoom(roomId)
    } catch (overviewErr) {
      logger.error('[HandEnded] fetchMatchOverviewForRoom failed', overviewErr)
    }

    if (p.outcome === 'showdown') {
      await sleep(gameRuntimeConfig.getGameWsStageChangedDelayMs())
    }

    wsGateway.notifyGameEndPerViewer(roomKey, (viewerUserId) => ({
      matchId: currentMatchId,
      settleList: buildSettleListForViewer(viewerUserId),
      matchOverview,
      boardThroughStage: p.endStage,
      bestRankCategory: p.bestRankCategory,
      gameDuration: Math.floor(
        (gameEndAt.getTime() - getRuntime().matchStartedAt) / 1000
      ),
      bestPokes: p.bestPokes ?? [],
      totalBetAmount
    }))
    if (sevenTwoAutoShownUserIds.size > 0) {
      for (const userId of sevenTwoAutoShownUserIds) {
        const player = seated.find((x) => x.getUserInfo().id === userId)
        if (!player) continue
        wsGateway.notifyPlayerHandVoluntarilyShown(roomKey, {
          roomId,
          matchId: currentMatchId,
          userId,
          handPokes: player.getHandPokes(),
          rankCategory: player.rankCategory ?? null
        })
      }
    }
    texas.unlockSeats()
    // 游戏结束后, 轮换庄家位置
    // 在其他玩家加入时, 有新的BB anchor
    texas.rotateRolesForNewHand()

    const removedAfterHandEndUserIds =
      gameRuntimeRegistry.flushDeferredTexasSeatRemovals(roomKey)
    for (const userId of removedAfterHandEndUserIds) {
      gameRuntimeRegistry.clearConnectionTracking(roomKey, userId)
      wsGateway.notifyPlayerQuitGame(
        roomKey,
        { roomId, userId },
        { excludeUserId: userId }
      )
    }
    const offlineGrace = await settleOfflineSeatGrace(ctx)
    if (offlineGrace.roomClosed) return
    const newlySeatedUserIds: number[] = []
    for (const watcher of texas.room.getPlayersBySeatStatus('hang')) {
      try {
        texas.room.seat(watcher)
        const uid = watcher.getUserInfo().id
        newlySeatedUserIds.push(uid)
        gameRuntimeRegistry.enqueuePendingPostBigBlind(roomKey, uid)
      } catch {
        // ignore: player may be removed concurrently
      }
    }

    if (newlySeatedUserIds.length > 0) {
      wsGateway.notifyPlayersSeated(roomKey, {
        roomId,
        matchId: currentMatchId,
        userIds: newlySeatedUserIds
      })
    }
    gameRuntimeRegistry.setQuitBlockedUntilBlindsPosted(roomKey, false)

    getRuntime().rollbackManager.clearInvalidatedFlag(currentMatchId)

    await roomModel.update({
      where: { id: roomId },
      data: { gameStatus: 'between_hands' }
    })
    maybeStartNextHandCountdown(roomId)
  } catch (err) {
    logger.error('HandEnded handler failed', err)
  }
}

async function processTexasDomainEvent(
  ctx: TexasEventContext,
  e: TexasDomainEvent
): Promise<void> {
  const { texas, roomId, roomKey, roomInfo, wsGateway, getRuntime } = ctx

  await appendMatchDomainEventTapeFromCtx(ctx, e)

  switch (e.type) {
    case 'RolesAssigned': {
      getRuntime().matchStartedAt = Date.now()
      const currentMatchId = getRuntime().currentMatchId
      if (currentMatchId == null) {
        logger.error('RolesAssigned skipped: currentMatchId is null')
        return
      }
      await match.update({
        where: { id: currentMatchId },
        data: { startedAt: new Date() }
      })
      const { players } = e.payload
      await prisma.$transaction(
        players.map((pl) => {
          const player = texas.dealer.getById(pl.userId)
          const balanceAtHandStart = Math.round(
            player?.balance ?? roomInfo.initialChips
          )
          return prisma.playerMatchRecord.upsert({
            where: {
              matchId_userId: {
                matchId: currentMatchId,
                userId: pl.userId
              }
            },
            create: {
              matchId: currentMatchId,
              userId: pl.userId,
              role: pl.role,
              handPokes: [],
              balanceAtHandStart
            },
            update: { role: pl.role, balanceAtHandStart }
          })
        })
      )
      wsGateway.notifyRolesAssigned(roomKey, {
        matchId: currentMatchId,
        roles: players.map((pl) => {
          const player = texas.dealer.getById(pl.userId)
          if (!player) {
            logger.error(
              `[RolesAssigned] player missing userId=${pl.userId} matchId=${currentMatchId}`
            )
          }
          const balance = player?.balance ?? roomInfo.initialChips
          return {
            userId: pl.userId,
            role: pl.role,
            actionIndex: pl.actionIndex,
            balance
          }
        })
      })
      return
    }
    case 'HoleCardsDealt': {
      const matchId = getRuntime().currentMatchId
      if (matchId == null) {
        logger.error('HoleCardsDealt skipped: currentMatchId is null')
        return
      }
      const entries = Object.entries(e.payload.byUserId)
      await prisma.$transaction(
        entries.map(([uid, handPokes]) =>
          prisma.playerMatchRecord.update({
            where: {
              matchId_userId: { matchId, userId: Number(uid) }
            },
            data: { handPokes }
          })
        )
      )
      for (const [uid, handPokes] of entries) {
        wsGateway.notifyHandDealtToUser(Number(uid), {
          matchId,
          roomId,
          handPokes
        })
      }
      return
    }
    case 'HandStarted': {
      const matchId = getRuntime().currentMatchId
      if (matchId == null) return
      await matchStageTimeRecord.create({
        data: { matchId, stage: 'pre_flop' }
      })
      wsGateway.notifyGameStart(roomKey, { matchId })
      return
    }
    case 'BlindsPosted': {
      gameRuntimeRegistry.setQuitBlockedUntilBlindsPosted(roomKey, false)
      const matchId = getRuntime().currentMatchId
      if (matchId != null) {
        await betRecord.createMany({
          data: e.payload.posts.map((post) => ({
            userId: post.userId,
            actionType: 'bet' as ActionType,
            amount: post.amount,
            stage: 'pre_flop',
            matchId,
            domainHandId: e.payload.handId,
            domainEventSeq: e.payload.seq
          })),
          skipDuplicates: true
        })
        wsGateway.notifyGameBlindsPosted(roomKey, {
          matchId,
          roomId,
          posts: e.payload.posts.map((post) => ({
            ...post,
            balance: texas.dealer.getById(post.userId)?.balance ?? 0
          })),
          pool: texas.pool.totalAmount
        })
      }
      return
    }
    case 'PostedBigBlind':
      {
        const matchId = getRuntime().currentMatchId
        if (matchId != null) {
          await betRecord.createMany({
            data: [
              {
                userId: e.payload.userId,
                actionType: 'bet' as ActionType,
                amount: e.payload.amount,
                stage: 'pre_flop',
                matchId,
                domainHandId: e.payload.handId,
                domainEventSeq: e.payload.seq
              }
            ],
            skipDuplicates: true
          })
        }
      }
      return
    case 'PotUpdated':
    case 'TurnEnded':
    case 'PotAwarded':
      return
    case 'PlayerActed': {
      const matchId = getRuntime().currentMatchId
      if (matchId == null) return
      const amount = e.payload.amount ?? 0
      let row: { id: number }
      try {
        row = await betRecord.create({
          data: {
            userId: e.payload.userId,
            actionType: e.payload.actionType as ActionType,
            amount,
            stage: e.payload.street,
            matchId,
            domainHandId: e.payload.handId,
            domainEventSeq: e.payload.seq
          },
          select: { id: true }
        })
      } catch (err) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002'
        ) {
          return
        }
        throw err
      }
      clearPlayerTurnTimeout(roomKey)
      const player = texas.dealer.find(
        (pl) => pl.getUserInfo().id === e.payload.userId
      )
      if (!player) {
        logger.error(`[PlayerActed] player missing userId=${e.payload.userId}`)
        return
      }
      wsGateway.notifyActionTaken(roomKey, {
        matchId,
        userId: e.payload.userId,
        actionId: row.id,
        actionType: e.payload.actionType,
        amount,
        pool: texas.pool.totalAmount,
        totalBetAmount: player.totalBetAmount,
        currentStageBetAmount: player.currentStageTotalAmount,
        balance: player.balance
      })
      return
    }
    case 'StageAdvanced': {
      const matchId = getRuntime().currentMatchId
      if (matchId == null) return
      // `update` 按 matchId_stage 在记录不存在时会抛 Prisma P2025（Record not found）。
      // 跑马路多段亮牌时，后续 fromStage 可能从未 insert（未为纯亮牌街建表），故用 updateMany：无行则 0 更新、不抛错。
      await matchStageTimeRecord.updateMany({
        where: {
          matchId,
          stage: e.payload.fromStage,
          endAt: null
        },
        data: { endAt: new Date() }
      })
      // 跑马路仅亮公牌：关闭 fromStage 即可，不为 toStage 建新行
      if (e.payload.advanceKind !== 'runout_reveal') {
        await matchStageTimeRecord.create({
          data: { matchId, stage: e.payload.toStage }
        })
      }
      wsGateway.notifyStageChanged(roomKey, {
        matchId,
        stage: e.payload.toStage,
        advanceKind: e.payload.advanceKind,
        pokesToReveal: e.payload.pokesRevealedThisStep
      })
      return
    }
    case 'TurnOffered': {
      const matchId = getRuntime().currentMatchId
      if (matchId == null) return
      if (gameRuntimeRegistry.hasQueuedLeave(roomKey, e.payload.userId)) {
        try {
          const autoFoldEvents = texas.dispatchCommand({
            type: 'FoldDueToLeave',
            playerId: e.payload.userId
          })
          await interpretTexasDomainEvents(ctx, autoFoldEvents)
          return
        } catch (err) {
          logger.error(
            `[TurnOffered] auto FoldDueToLeave failed userId=${e.payload.userId} roomId=${roomId}`,
            err
          )
          throw err
        }
      }
      const serverNow = Date.now()
      /**
       * 离线托管：轮到离线玩家时不再使用房间常规思考时长，统一短计时 5s。
       * 到期后仍走既有 timeout 分支（CheckDueToTimeout/FoldDueToTimeout）。
       */
      const thinkingTimeMs = gameRuntimeRegistry.isUserOffline(
        roomKey,
        e.payload.userId
      )
        ? OFFLINE_TURN_THINKING_TIME_MS
        : roomInfo.thinkingTime * 1000
      const deadlineAt = serverNow + thinkingTimeMs
      schedulePlayerTurnTimeout({
        roomKey,
        userId: e.payload.userId,
        deadlineAt,
        handId: e.payload.handId
      })
      wsGateway.notifyActionRequired(roomKey, {
        matchId,
        userId: e.payload.userId,
        deadlineAt,
        allowedActions: e.payload.allowedActions,
        restrict: e.payload.restrict,
        serverNow
      })
      return
    }
    case 'HandEnded':
      await handleHandEnded(ctx, e)
      return
    default: {
      const _exhaustive: never = e
      void _exhaustive
    }
  }
}

async function drainBufferedDomainEvents(
  ctx: TexasEventContext
): Promise<void> {
  for (;;) {
    const batch = ctx.texas.drainDomainEvents()
    if (batch.length === 0) break
    for (const ev of batch) {
      await processTexasDomainEvent(ctx, ev)
    }
  }
}

/**
 * Core 固定使用 `pendingFlowOps`：行动结束后先等 `actionRequired` 间隔，再按队列消费进街/交权；
 * 连续进街之间再等 `stageChanged` 间隔。
 */
async function drainPendingFlowQueueWithPacing(
  ctx: TexasEventContext
): Promise<void> {
  const texas = ctx.texas
  if (texas.getPendingFlowOps().length === 0) return

  const afterActionMs = gameRuntimeConfig.getGameWsActionRequiredDelayMs()
  const betweenStagesMs = gameRuntimeConfig.getGameWsStageChangedDelayMs()

  await sleep(afterActionMs)

  while (texas.getPendingFlowOps().length > 0) {
    const [head] = texas.getPendingFlowOps()
    if (head?.kind === 'stage_advance') {
      const stepEvents = texas.applyPendingStageAdvance()
      await interpretTexasDomainEvents(ctx, stepEvents)
      await drainBufferedDomainEvents(ctx)
      if (texas.getPendingFlowOps().length > 0) {
        await sleep(betweenStagesMs)
      }
    } else {
      const stepEvents = texas.flushPendingTurnHandoff()
      await interpretTexasDomainEvents(ctx, stepEvents)
      await drainBufferedDomainEvents(ctx)
    }
  }
}

function scheduleDeferredPendingFlowPacing(ctx: TexasEventContext): void {
  void (async () => {
    try {
      await drainPendingFlowQueueWithPacing(ctx)
    } catch (e: unknown) {
      if (e instanceof TexasError && isFatalTexasErrorCode(e.code)) {
        await handleFatalTexasEngineError({
          error: e,
          roomId: ctx.roomId,
          roomKey: ctx.roomKey,
          getRuntime: ctx.getRuntime
        })
      } else {
        logger.error('[texas domain] deferred pacing failed', e)
      }
    }
  })()
}

export type DrainAndInterpretOptions = {
  /** Core 同步返回的一批事件（已 drain，须先解释再消费队列） */
  preEvents?: readonly TexasDomainEvent[]
  /**
   * 为 true 时：只 await `preEvents` 解释与 `drainBufferedDomainEvents`；
   * `pendingFlowOps` 节拍队列在后台继续跑，不阻塞 HTTP 响应。
   */
  deferPacing?: boolean
}

/**
 * 解释领域事件并按运行时配置节拍消费 `pendingFlowOps`。
 * 与 texas-poker-core 同步返回 API 对齐：`dispatchCommand` / `applyPendingStageAdvance` 等返回值经 `preEvents` 传入。
 */
export async function drainAndInterpretTexas(
  ctx: TexasEventContext,
  options?: DrainAndInterpretOptions
): Promise<void> {
  if (options?.preEvents?.length) {
    await interpretTexasDomainEvents(ctx, options.preEvents)
  }
  await drainBufferedDomainEvents(ctx)
  if (options?.deferPacing) {
    scheduleDeferredPendingFlowPacing(ctx)
    return
  }
  await drainPendingFlowQueueWithPacing(ctx)
}
