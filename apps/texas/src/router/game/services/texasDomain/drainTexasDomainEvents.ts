import type { Player } from 'texas-poker-core'
import type { ActionType } from '@prisma/texas-client'
import type { TexasDomainEvent } from 'texas-poker-core'
import type { TexasEventContext } from './texasEventContext'
import type { WsMatchOverview } from '../../../../ws/ws-event-types'

import { Prisma } from '@prisma/texas-client'

import { logger } from '../../../../logger'
import { fetchMatchOverviewForRoom } from '../matchOverviewAggregation'
import { maybeStartNextHandCountdown } from '../../../../gameRuntime/nextHandCountdown'
import prisma, {
  match,
  betRecord,
  room as roomModel,
  matchStageTimeRecord
} from '../../../../models'

const STAGE_ADVANCED_PACING_MS = 2000

function sleep(ms: number): Promise<void> {
  return ms <= 0 ? Promise.resolve() : new Promise((r) => setTimeout(r, ms))
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

  try {
    const gameEndAt = new Date()
    const currentMatchId = getRuntime().currentMatchId
    if (currentMatchId == null) {
      logger.error('HandEnded skipped: currentMatchId is null')
      return
    }

    texas.settle()
    await flushEventsAfterSettle(ctx)

    const seated = texas.room.getPlayersBySeatStatus('on-set')
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

    const buildSettleListForViewer = (viewerUserId: number) =>
      sortedSeated.map((pl) => {
        const userId = pl.getUserInfo().id
        const isFold = pl.getStatus() === 'out'
        let handPokes = pl.getHandPokes()
        const hideHoleFromViewer =
          viewerUserId !== userId && (isFold || !p.showHandPokes)
        if (hideHoleFromViewer) {
          handPokes = []
        }
        return {
          userId,
          balance: pl.balance,
          wager: pl.wager,
          isAllIn: pl.getStatus() === 'allIn',
          isFold,
          canVoluntaryShowHand: isFold || unfoldedOnSetCount === 1,
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
        lastActionStage: p.currentStage,
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
          balanceAfterHand: Math.round(pl.balance)
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

    let matchOverview: WsMatchOverview = { wagerList: [], billList: [] }
    try {
      matchOverview = await fetchMatchOverviewForRoom(roomId)
    } catch (overviewErr) {
      logger.error('[HandEnded] fetchMatchOverviewForRoom failed', overviewErr)
    }

    wsGateway.notifyGameEndPerViewer(roomKey, (viewerUserId) => ({
      matchId: currentMatchId,
      settleList: buildSettleListForViewer(viewerUserId),
      matchOverview,
      lastActionStage: p.currentStage,
      boardThroughStage: p.endStage,
      pokesToReveal: p.pokesRevealed,
      bestRankCategory: p.bestRankCategory,
      gameDuration: Math.floor(
        (gameEndAt.getTime() - getRuntime().matchStartedAt) / 1000
      ),
      bestPokes: p.bestPokes ?? [],
      totalBetAmount
    }))

    getRuntime().rollbackManager.clearInvalidatedFlag(currentMatchId)
    getRuntime().rollbackManager.clearSnapshot(currentMatchId)

    await roomModel.update({
      where: { id: roomId },
      data: { gameStatus: 'between_hands' }
    })
    texas.controller.reset()
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
        players.map((pl) =>
          prisma.playerMatchRecord.upsert({
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
              handPokes: []
            },
            update: { role: pl.role }
          })
        )
      )
      wsGateway.notifyRolesAssigned(roomKey, {
        matchId: currentMatchId,
        roles: players.map((pl) => ({
          userId: pl.userId,
          role: pl.role,
          actionIndex: pl.actionIndex
        }))
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
    case 'BlindsPosted':
    case 'PotUpdated':
    case 'TurnEnded':
    case 'PotAwarded':
      return
    case 'PlayerActed': {
      const matchId = getRuntime().currentMatchId
      if (matchId == null) return
      const dup = await betRecord.findFirst({
        where: {
          matchId,
          domainHandId: e.payload.handId,
          domainEventSeq: e.payload.seq
        }
      })
      if (dup) return

      const amount = e.payload.amount ?? 0
      const row = await betRecord.create({
        data: {
          userId: e.payload.userId,
          actionType: e.payload.actionType as ActionType,
          amount,
          stage: e.payload.street,
          matchId,
          domainHandId: e.payload.handId,
          domainEventSeq: e.payload.seq
        }
      })
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
      await matchStageTimeRecord.update({
        where: {
          matchId_stage: {
            matchId,
            stage: e.payload.fromStage
          }
        },
        data: { endAt: new Date() }
      })
      await matchStageTimeRecord.create({
        data: { matchId, stage: e.payload.toStage }
      })
      wsGateway.notifyStageChanged(roomKey, {
        matchId,
        stage: e.payload.toStage,
        pokesToReveal: e.payload.pokesRevealedThisStep
      })
      await sleep(STAGE_ADVANCED_PACING_MS)
      return
    }
    case 'TurnOffered': {
      const matchId = getRuntime().currentMatchId
      if (matchId == null) return
      const serverNow = Date.now()
      const thinkingTimeMs = roomInfo.thinkingTime * 1000
      wsGateway.notifyActionRequired(roomKey, {
        matchId,
        userId: e.payload.userId,
        deadlineAt: serverNow + thinkingTimeMs,
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

/**
 * 排空 Texas 领域事件缓冲：持久化、WS、并在 `StageAdvanced` 后统一停顿 2s。
 */
export async function drainAndInterpretTexas(
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
