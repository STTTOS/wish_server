import type { Role, Stage, ActionType } from '@prisma/texas-client'

import { Prisma } from '@prisma/texas-client'

import prisma from '../models'
import { logger } from '../logger'
import {
  stageToStreet,
  PLAYER_TECH_VERSION,
  roleToPositionBucket,
  type DecisionLineTag,
  buildDecisionSnapshot,
  type DecisionActionType
} from './engine'

const parsePokes = (raw: unknown): string[] => {
  if (!Array.isArray(raw)) return []
  return raw.filter((x): x is string => typeof x === 'string')
}

const toActionType = (t: ActionType): DecisionActionType => {
  if (t === 'fold') return 'fold'
  if (t === 'check') return 'check'
  if (t === 'call') return 'call'
  if (t === 'bet') return 'bet'
  if (t === 'raise') return 'raise'
  return 'allIn'
}

const isRaiseLike = (t: ActionType) =>
  t === 'raise' || t === 'bet' || t === 'allIn'

type SeatMeta = {
  role: Role | null
  balanceStart: number | null
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

  const bb = Math.max(matchRow.lowestBetAmount, 1)
  const boardPokes = parsePokes(matchRow.commonPokes)
  const seats = new Map<number, SeatMeta>()
  for (const p of matchRow.playerMatchRecords) {
    seats.set(p.userId, {
      role: p.role,
      balanceStart: p.balanceAtHandStart
    })
  }

  let potBb = 0
  let street: Stage = 'pre_flop'
  let preflopOpened = false
  let streetAggressor: number | null = null
  /** 本街当前需跟注额（相对上一次进攻） */
  let toCallFacingBb = 0
  let actionIndex = 0

  const rows: ReturnType<typeof buildDecisionSnapshot>[] = []

  for (const rec of matchRow.records) {
    if (rec.stage !== street) {
      street = rec.stage
      streetAggressor = null
      toCallFacingBb = 0
    }

    const amountBb = Math.max(0, rec.amount) / bb
    const isForced = rec.source === 'blind'
    const seat = seats.get(rec.userId)
    const heroStackBb =
      seat?.balanceStart != null ? Math.max(0, seat.balanceStart / bb) : 100

    // 行动前底池 / 面对的跟注额
    const potBefore = potBb
    let toCallBefore = 0
    if (!isForced && rec.actionType !== 'check' && rec.actionType !== 'fold') {
      toCallBefore = toCallFacingBb
    }

    let lineTag: DecisionLineTag = 'other'
    if (street === 'pre_flop' && !preflopOpened) {
      lineTag = 'unopened'
    } else if (street === 'pre_flop' && preflopOpened && toCallBefore > 1.5) {
      lineTag = 'vs_raise'
    } else if (street === 'pre_flop' && preflopOpened && toCallBefore > 0) {
      lineTag = 'vs_open'
    } else if (streetAggressor === rec.userId) {
      lineTag = 'as_pfr'
    } else if (toCallFacingBb > 0 && street !== 'pre_flop') {
      lineTag = streetAggressor != null ? 'vs_cbet' : 'vs_bet'
    } else if (toCallFacingBb > 0) {
      lineTag = 'vs_bet'
    }

    if (!isForced) {
      const snap = buildDecisionSnapshot({
        matchId,
        userId: rec.userId,
        actionIndex,
        street: stageToStreet(street),
        playersInHand: seats.size,
        heroPosition: roleToPositionBucket(seat?.role),
        heroStackBb,
        potBb: potBefore,
        toCallBb: toCallBefore,
        boardPokes: street === 'pre_flop' ? [] : boardPokes,
        lineTag,
        aggressorIsHero: streetAggressor === rec.userId,
        actionType: toActionType(rec.actionType),
        actionSizeBb: amountBb,
        isForced: false
      })
      rows.push(snap)
      actionIndex += 1
    }

    // 更新 pot / 进攻方
    potBb += amountBb
    if (isRaiseLike(rec.actionType)) {
      streetAggressor = rec.userId
      // 简化：加注后他人至少再跟 amountBb（相对粗；够用 P0）
      toCallFacingBb = Math.max(amountBb, toCallFacingBb)
      if (street === 'pre_flop') preflopOpened = true
    } else if (rec.actionType === 'call') {
      toCallFacingBb = Math.max(0, toCallFacingBb - amountBb)
    } else if (rec.actionType === 'check' || rec.actionType === 'fold') {
      // no pot raise
    }
  }

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
