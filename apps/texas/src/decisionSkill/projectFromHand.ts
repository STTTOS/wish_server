import { Prisma } from '@prisma/texas-client'

import prisma from '../models'
import { logger } from '../logger'
import { PLAYER_TECH_VERSION } from './engine'
import { projectDecisionSnapshots } from './projectSnapshots'

const parsePokes = (raw: unknown): string[] => {
  if (!Array.isArray(raw)) return []
  return raw.filter((x): x is string => typeof x === 'string')
}

/**
 * 一手结束后投影 DecisionSkillSnapshot（不含洞牌；盲注不落库）。
 * 幂等：DecisionSkillAppliedHand。
 */
export const projectDecisionSkillForHandSafe = async (matchId: number) => {
  try {
    await projectDecisionSkillForHand(matchId)
  } catch (err) {
    logger.error(`[decisionSkill] project failed matchId=${matchId}`, err)
  }
}

export const projectDecisionSkillForHand = async (matchId: number) => {
  const matchRow = await prisma.match.findUnique({
    where: { id: matchId },
    select: {
      id: true,
      lowestBetAmount: true,
      commonPokes: true,
      records: {
        orderBy: { id: 'asc' },
        select: {
          id: true,
          userId: true,
          actionType: true,
          amount: true,
          stage: true,
          source: true
        }
      },
      playerMatchRecords: {
        select: {
          userId: true,
          role: true,
          balanceAtHandStart: true
        }
      }
    }
  })
  if (!matchRow) return

  const rows = projectDecisionSnapshots({
    matchId,
    lowestBetAmount: matchRow.lowestBetAmount,
    boardPokes: parsePokes(matchRow.commonPokes),
    records: matchRow.records,
    seats: matchRow.playerMatchRecords.map((p) => ({
      userId: p.userId,
      role: p.role,
      balanceStart: p.balanceAtHandStart
    }))
  })

  if (!rows.length) {
    await prisma.$transaction(async (tx) => {
      try {
        await tx.decisionSkillAppliedHand.create({
          data: { matchId, techVersion: PLAYER_TECH_VERSION }
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
    })
    return
  }

  await prisma.$transaction(async (tx) => {
    try {
      await tx.decisionSkillAppliedHand.create({
        data: { matchId, techVersion: PLAYER_TECH_VERSION }
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

    await tx.decisionSkillSnapshot.createMany({
      data: rows.map((s) => ({
        matchId: s.matchId,
        userId: s.userId,
        actionIndex: s.actionIndex,
        schemaVersion: s.schemaVersion,
        strategyVersion: null,
        street: s.street,
        playersInHand: s.playersInHand,
        heroPosition: s.heroPosition,
        heroStackBb: s.heroStackBb,
        potBb: s.potBb,
        toCallBb: s.toCallBb,
        spr: s.spr,
        boardPokes: s.boardPokes,
        boardTexture: s.boardTexture,
        lineTag: s.lineTag,
        aggressorIsHero: s.aggressorIsHero,
        actionType: s.actionType,
        actionSizeBb: s.actionSizeBb,
        actionSizePotFrac: s.actionSizePotFrac,
        isForced: s.isForced,
        potOdds: s.potOdds
      }))
    })
  })
}
