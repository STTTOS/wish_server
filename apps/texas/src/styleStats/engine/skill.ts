import type { StyleCounters, SkillBreakdown } from './types'

import { SKILL_WEIGHTS } from './constants'
import { axesFromCounters } from './fromCounters'

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n))

/** Adj bb/100 → 0–100（约 -20..+20bb/100 映射） */
const scoreAdjBb100 = (adjBbPer100: number): number =>
  clamp(50 + adjBbPer100 * 2.5)

/** 全下平均 equity → 0–100（0.5≈50，0.7≈90） */
const scoreAvgEquity = (avgEq: number | null): number => {
  if (avgEq == null) return 55
  return clamp(avgEq * 100 + 10)
}

/**
 * L1 40%：去跑马战绩 + 全下平均 equity
 * L2 30%：选牌合规 / limp 惩罚
 * L3 22%：红线占比（施压印钱）
 * L4 8%：极端打法漏洞扣分（默认高分）
 */
export const skillFromCounters = (c: StyleCounters): SkillBreakdown => {
  const hands = Math.max(c.hands, 1)
  const adjBb100 = (c.allInAdjWagerBb / hands) * 100
  const avgEq =
    c.allInEquityCount > 0 ? c.allInEquitySum / c.allInEquityCount : null

  const skillL1 = clamp(
    0.7 * scoreAdjBb100(adjBb100) + 0.3 * scoreAvgEquity(avgEq)
  )

  // 合规率只用「已知洞牌的入池手」；无样本时给中性分，避免缺洞牌 → 全员 L2=0
  const chartRate =
    c.chartKnownVpipHands > 0
      ? c.chartOkVpipHands / c.chartKnownVpipHands
      : 0.55
  const limpRate = c.hands > 0 ? c.limpHands / c.hands : 0
  // 基线 15 + 合规主导 − limp 轻罚（原 limp×80 易把松池打到贴零）
  const skillL2 = clamp(15 + chartRate * 85 - limpRate * 45)

  const absRed = Math.abs(c.redlineBb)
  const absBlue = Math.abs(c.bluelineBb)
  const lineDen = absRed + absBlue
  const redShare = lineDen > 0 ? absRed / lineDen : 0.5
  // 红线份额适中偏高更好；纯蓝线摊牌赌跑马略扣
  const skillL3 = clamp(40 + redShare * 60)

  const axes = axesFromCounters(c)
  const vpip = axes.axisVpip ?? 25
  const pfr = axes.axisPfr ?? 18
  const wtsd = axes.axisWtsd ?? 26
  const wsd = axes.axisWsd ?? 50
  const pfrRatio = vpip > 0 ? pfr / vpip : 1

  let skillL4 = 100
  if (vpip >= 45 && pfrRatio < 0.45) skillL4 -= 40
  if (wtsd >= 35 && wsd < 45) skillL4 -= 35
  if (vpip >= 55) skillL4 -= 15
  skillL4 = clamp(skillL4)

  const skillScore = clamp(
    SKILL_WEIGHTS.l1 * skillL1 +
      SKILL_WEIGHTS.l2 * skillL2 +
      SKILL_WEIGHTS.l3 * skillL3 +
      SKILL_WEIGHTS.l4 * skillL4
  )

  return { skillL1, skillL2, skillL3, skillL4, skillScore }
}
