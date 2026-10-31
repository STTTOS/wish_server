import type { Stage } from '@prisma/texas-client'

import { Prisma } from '@prisma/texas-client'

import prisma from '../models'
import { logger } from '../logger'
import { applyHandStyleDeltas } from './applyIncremental'
import {
  STYLE_SCOPE_ALL,
  STYLE_STATS_VERSION,
  type StyleHandInput,
  computeHandStyleDeltas
} from './engine'

const parsePokes = (raw: unknown): string[] => {
  if (!Array.isArray(raw)) return []
  return raw.filter((x): x is string => typeof x === 'string')
}

/**
 * 一手结算后更新牌风物化表。失败只打日志，不抛给结算主路径。
 */
export const applyStyleStatsForHandSafe = async (matchId: number) => {
  try {
    await applyStyleStatsForHand(matchId)
  } catch (err) {
    logger.error(`[styleStats] apply failed matchId=${matchId}`, err)
  }
}

export const applyStyleStatsForHand = async (matchId: number) => {
  const matchRow = await prisma.match.findUnique({
    where: { id: matchId },
    select: {
      id: true,
      lowestBetAmount: true,
      commonPokes: true,
      boardThroughStage: true,
      room: { select: { tableType: true } },
      records: {
        where: { source: 'action' },
        orderBy: { id: 'asc' },
        select: {
          userId: true,
          actionType: true,
          amount: true,
          stage: true
        }
      },
      playerMatchRecords: {
        select: {
          userId: true,
          role: true,
          handPokes: true,
          wager: true,
          isFold: true,
          isAllIn: true,
          sevenTwoBonusPaid: true,
          sevenTwoBonusReceived: true
        }
      }
    }
  })
  if (!matchRow) return

  // 摊牌 = 仍有 ≥2 人未弃牌。勿用 rankCategory：fold_win 在已发公牌时 Core 仍会给未弃牌者写牌力。
  const nonFoldCount = matchRow.playerMatchRecords.filter(
    (p) => !p.isFold
  ).length

  const input: StyleHandInput = {
    matchId,
    lowestBetAmount: matchRow.lowestBetAmount,
    boardPokes: parsePokes(matchRow.commonPokes),
    boardThroughStage: matchRow.boardThroughStage as Stage | null,
    actions: matchRow.records.map((r) => ({
      userId: r.userId,
      actionType: r.actionType,
      amount: r.amount,
      stage: r.stage
    })),
    seats: matchRow.playerMatchRecords.map((p) => ({
      userId: p.userId,
      role: p.role,
      handPokes: parsePokes(p.handPokes),
      // 去掉 27o 局外奖励，保留底池净输赢
      wager:
        p.wager - (p.sevenTwoBonusReceived ?? 0) + (p.sevenTwoBonusPaid ?? 0),
      isFold: p.isFold,
      isAllIn: p.isAllIn,
      wentToShowdown: !p.isFold && nonFoldCount >= 2
    }))
  }

  const deltas = computeHandStyleDeltas(input)
  const tableType = matchRow.room.tableType
  const scopes = [STYLE_SCOPE_ALL, tableType]

  await prisma.$transaction(async (tx) => {
    try {
      await tx.styleStatAppliedHand.create({
        data: { matchId, statsVersion: STYLE_STATS_VERSION }
      })
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        // 同一 match 已增量过，跳过防双计
        return
      }
      throw err
    }
    await applyHandStyleDeltas(tx, { matchId, scopes, deltas })
  })
}
