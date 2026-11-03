import { Prisma } from '@prisma/texas-client'

import prisma from '../models'
import { logger } from '../logger'
import { PLAYER_DISCIPLINE_VERSION } from './engine'
import { projectDecisionSnapshots } from './projectSnapshots'

/**
 * 一手结束后投影行动快照（不含洞牌；盲注不落库）。
 * 幂等：DisciplineAppliedHand。
 */
export const projectDisciplineForHandSafe = async (matchId: number) => {
  try {
    await projectDisciplineForHand(matchId)
  } catch (err) {
    logger.error(`[discipline] project failed matchId=${matchId}`, err)
  }
}

export const projectDisciplineForHand = async (matchId: number) => {
  const matchRow = await prisma.match.findUnique({
    where: { id: matchId },
    select: {
      id: true,
      lowestBetAmount: true,
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
          role: true
        }
      }
    }
  })
  if (!matchRow) return

  const rows = projectDecisionSnapshots({
    matchId,
    lowestBetAmount: matchRow.lowestBetAmount,
    records: matchRow.records,
    seats: matchRow.playerMatchRecords.map((p) => ({
      userId: p.userId,
      role: p.role
    }))
  })

  if (!rows.length) {
    await prisma.$transaction(async (tx) => {
      try {
        await tx.disciplineAppliedHand.create({
          data: { matchId, disciplineVersion: PLAYER_DISCIPLINE_VERSION }
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
      await tx.disciplineAppliedHand.create({
        data: { matchId, disciplineVersion: PLAYER_DISCIPLINE_VERSION }
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

    await tx.disciplineActionSnapshot.createMany({
      data: rows.map((s) => ({
        matchId: s.matchId,
        userId: s.userId,
        actionIndex: s.actionIndex,
        schemaVersion: s.schemaVersion,
        rulesVersion: null,
        street: s.street,
        playersInHand: s.playersInHand,
        heroPosition: s.heroPosition,
        potBb: s.potBb,
        toCallBb: s.toCallBb,
        lineTag: s.lineTag,
        actionType: s.actionType,
        actionSizeBb: s.actionSizeBb,
        actionSizePotFrac: s.actionSizePotFrac,
        isForced: s.isForced,
        potOdds: s.potOdds
      }))
    })
  })
}
