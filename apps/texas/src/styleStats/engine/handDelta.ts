import type { Stage } from '@prisma/texas-client'

import { estimateHuEquity } from './equity'
import { isHoleInChart, normalizeHoleLabel } from './chartRanges'
import {
  type StyleAction,
  emptyHandStyleDelta,
  type HandStyleDelta,
  type StyleHandInput
} from './types'

const STAGE_ORDER: Stage[] = ['pre_flop', 'flop', 'turn', 'river']

const stageAtLeast = (a: Stage | null, b: Stage): boolean => {
  if (!a) return false
  return STAGE_ORDER.indexOf(a) >= STAGE_ORDER.indexOf(b)
}

const isAggressive = (t: string) =>
  t === 'bet' || t === 'raise' || t === 'allIn'

const isVoluntaryPut = (t: string) =>
  t === 'call' || t === 'raise' || t === 'bet' || t === 'allIn'

const isRaiseLike = (t: string) => t === 'raise' || t === 'bet' || t === 'allIn'

/**
 * 从一手行动/结算构造每位玩家的 HandStyleDelta。
 */
export const computeHandStyleDeltas = (
  input: StyleHandInput
): Map<number, HandStyleDelta> => {
  const { actions, seats, lowestBetAmount, boardPokes, boardThroughStage } =
    input
  const bb = Math.max(lowestBetAmount, 1)
  const byUser = new Map<number, HandStyleDelta>()
  for (const seat of seats) {
    byUser.set(seat.userId, emptyHandStyleDelta())
  }

  const preflop = actions.filter((a) => a.stage === 'pre_flop')
  const postflop = actions.filter((a) => a.stage !== 'pre_flop')

  let lastPreflopAggressor: number | null = null
  for (const a of preflop) {
    if (isRaiseLike(a.actionType)) lastPreflopAggressor = a.userId
  }

  for (const seat of seats) {
    const d = byUser.get(seat.userId)!
    d.hands = 1

    const myPre = preflop.filter((a) => a.userId === seat.userId)
    const vpip = myPre.some((a) => isVoluntaryPut(a.actionType))
    const pfr = myPre.some((a) => isRaiseLike(a.actionType))
    if (vpip) d.vpipHands = 1
    if (pfr) d.pfrHands = 1

    const limp = vpip && !pfr && myPre.some((a) => a.actionType === 'call')
    if (limp) d.limpHands = 1

    // 选牌：仅洞牌可解析时计入；缺洞牌既不奖也不罚
    if (vpip && normalizeHoleLabel(seat.handPokes)) {
      d.chartKnownVpipHands = 1
      if (isHoleInChart(seat.handPokes, seat.role)) d.chartOkVpipHands = 1
    }

    // 3-bet：扫 preflop；自己行动时若此前已有他人加注次数>=1
    let raisesByOthers = 0
    let hadOpp = false
    let did3 = false
    for (const a of preflop) {
      if (a.userId === seat.userId) {
        if (raisesByOthers >= 1) {
          hadOpp = true
          if (a.actionType === 'raise' || a.actionType === 'allIn') did3 = true
        }
      } else if (isRaiseLike(a.actionType)) {
        raisesByOthers += 1
      }
    }
    if (hadOpp) d.threeBetOpps = 1
    if (did3) d.threeBetHands = 1

    const foldedPre = myPre.some((a) => a.actionType === 'fold')
    // AFq（对齐常见 PT）：(bet+raise+allIn)/(同集合+call+check)；不含 fold
    const myPost = postflop.filter((a) => a.userId === seat.userId)
    for (const a of myPost) {
      if (a.actionType === 'fold') continue
      d.afqActions += 1
      if (isAggressive(a.actionType)) d.afqAggressive += 1
    }

    if (
      lastPreflopAggressor === seat.userId &&
      !foldedPre &&
      stageAtLeast(boardThroughStage, 'flop')
    ) {
      d.cbetOpps = 1
      const flopActs = actions.filter(
        (a) => a.stage === 'flop' && a.userId === seat.userId
      )
      if (flopActs.some((a) => isAggressive(a.actionType))) d.cbetHands = 1
    }

    const sawFlop =
      !foldedPre &&
      (stageAtLeast(boardThroughStage, 'flop') || myPost.length > 0)
    if (sawFlop) {
      d.sawFlopHands = 1
      if (seat.wentToShowdown) {
        d.wtsdHands = 1
        if (seat.wager > 0) d.wsdWonHands = 1
      }
    }

    const wagerBb = seat.wager / bb
    d.realizedWagerBb = wagerBb
    d.allInAdjWagerBb = wagerBb
    if (seat.wentToShowdown) {
      d.bluelineBb = wagerBb
    } else {
      d.redlineBb = wagerBb
    }
  }

  applyHuAllInAdj(byUser, seats, actions, boardPokes, bb)
  return byUser
}

const applyHuAllInAdj = (
  byUser: Map<number, HandStyleDelta>,
  seats: StyleHandInput['seats'],
  actions: StyleAction[],
  boardPokes: string[],
  bb: number
) => {
  const allInIds = new Set<number>()
  for (const a of actions) {
    if (a.actionType === 'allIn') allInIds.add(a.userId)
  }
  for (const s of seats) {
    if (s.isAllIn) allInIds.add(s.userId)
  }
  if (allInIds.size !== 2 || boardPokes.length >= 5) return

  const ids = [...allInIds]
  const s1 = seats.find((s) => s.userId === ids[0])
  const s2 = seats.find((s) => s.userId === ids[1])
  if (!s1 || !s2) return
  if (s1.handPokes.length !== 2 || s2.handPokes.length !== 2) return

  const eq1 = estimateHuEquity(s1.handPokes, s2.handPokes, boardPokes)
  if (eq1 == null) return
  const eq2 = 1 - eq1
  const halfPotBb = (Math.abs(s1.wager) + Math.abs(s2.wager)) / 2 / bb

  const d1 = byUser.get(s1.userId)!
  const d2 = byUser.get(s2.userId)!
  d1.allInAdjWagerBb = (2 * eq1 - 1) * halfPotBb
  d2.allInAdjWagerBb = (2 * eq2 - 1) * halfPotBb
  d1.allInEquitySum = eq1
  d1.allInEquityCount = 1
  d2.allInEquitySum = eq2
  d2.allInEquityCount = 1
}
