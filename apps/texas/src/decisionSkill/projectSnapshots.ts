import type { Role, Stage, ActionType } from '@prisma/texas-client'

import {
  stageToStreet,
  roleToPositionBucket,
  type DecisionLineTag,
  buildDecisionSnapshot,
  type DecisionSnapshot,
  type DecisionActionType
} from './engine'

export type ProjectRecord = {
  userId: number
  actionType: ActionType
  amount: number
  stage: Stage
  source: 'blind' | 'action' | string
}

export type ProjectSeat = {
  userId: number
  role: Role | null
  balanceStart: number | null
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

/** 按街截断公牌，避免用河牌纹理评翻牌决策 */
export const boardPokesForStreet = (
  stage: Stage,
  allBoard: string[]
): string[] => {
  if (stage === 'pre_flop') return []
  if (stage === 'flop') return allBoard.slice(0, 3)
  if (stage === 'turn') return allBoard.slice(0, 4)
  return allBoard.slice(0, 5)
}

/**
 * 从 BetRecord 序列投影决策快照（纯函数，不含洞牌、不写库）。
 * 盲注只推进底池/面对跟注额，不算开池、不算进攻方。
 */
export const projectDecisionSnapshots = (input: {
  matchId: number
  lowestBetAmount: number
  boardPokes: string[]
  records: ProjectRecord[]
  seats: ProjectSeat[]
}): DecisionSnapshot[] => {
  const bb = Math.max(input.lowestBetAmount, 1)
  const seatMap = new Map(input.seats.map((s) => [s.userId, s] as const))

  let potBb = 0
  let street: Stage = 'pre_flop'
  let preflopOpened = false
  /** 本街自愿进攻方 */
  let streetAggressor: number | null = null
  /** 翻前最后自愿加注者（跨街保留，供 as_pfr / vs_cbet） */
  let preflopAggressor: number | null = null
  let toCallFacingBb = 0
  let actionIndex = 0
  const rows: DecisionSnapshot[] = []

  for (const rec of input.records) {
    if (rec.stage !== street) {
      street = rec.stage
      streetAggressor = null
      toCallFacingBb = 0
    }

    const amountBb = Math.max(0, rec.amount) / bb
    const isForced = rec.source === 'blind'
    const seat = seatMap.get(rec.userId)
    const heroStackBb =
      seat?.balanceStart != null ? Math.max(0, seat.balanceStart / bb) : 100

    const potBefore = potBb
    // fold/call/raise 面对跟注价；check 可过 → 0
    let toCallBefore = 0
    if (!isForced && rec.actionType !== 'check') {
      toCallBefore = toCallFacingBb
    }

    const aggressorIsHero =
      streetAggressor === rec.userId ||
      (street !== 'pre_flop' &&
        streetAggressor == null &&
        preflopAggressor === rec.userId)

    let lineTag: DecisionLineTag = 'other'
    if (street === 'pre_flop' && !preflopOpened) {
      lineTag = 'unopened'
    } else if (street === 'pre_flop' && preflopOpened && toCallBefore > 1.5) {
      lineTag = 'vs_raise'
    } else if (street === 'pre_flop' && preflopOpened && toCallBefore > 0) {
      lineTag = 'vs_open'
    } else if (
      street !== 'pre_flop' &&
      preflopAggressor === rec.userId &&
      toCallBefore <= 0
    ) {
      lineTag = 'as_pfr'
    } else if (toCallFacingBb > 0 && street !== 'pre_flop') {
      lineTag =
        streetAggressor != null && streetAggressor === preflopAggressor
          ? 'vs_cbet'
          : 'vs_bet'
    } else if (toCallFacingBb > 0) {
      lineTag = 'vs_bet'
    }

    if (!isForced) {
      rows.push(
        buildDecisionSnapshot({
          matchId: input.matchId,
          userId: rec.userId,
          actionIndex,
          street: stageToStreet(street),
          playersInHand: seatMap.size,
          heroPosition: roleToPositionBucket(seat?.role),
          heroStackBb,
          potBb: potBefore,
          toCallBb: toCallBefore,
          boardPokes: boardPokesForStreet(street, input.boardPokes),
          lineTag,
          aggressorIsHero,
          actionType: toActionType(rec.actionType),
          actionSizeBb: amountBb,
          isForced: false
        })
      )
      actionIndex += 1
    }

    potBb += amountBb
    if (isForced) {
      // 贴盲：抬高需跟到当前最大盲注，但不算开池
      toCallFacingBb = Math.max(toCallFacingBb, amountBb)
      continue
    }
    if (isRaiseLike(rec.actionType)) {
      streetAggressor = rec.userId
      toCallFacingBb = Math.max(amountBb, toCallFacingBb)
      if (street === 'pre_flop') {
        preflopOpened = true
        preflopAggressor = rec.userId
      }
    } else if (rec.actionType === 'call') {
      toCallFacingBb = Math.max(0, toCallFacingBb - amountBb)
    }
  }

  return rows
}
