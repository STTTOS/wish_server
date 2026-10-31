import type { StyleCounters, SkillBreakdown } from './types'

import { SKILL_WEIGHTS } from './constants'
import { axesFromCounters } from './fromCounters'

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n))

/** Adj bb/100 → 0–100（约 -20..+20bb/100 映射） */
const scoreAdjBb100 = (adjBbPer100: number): number =>
  clamp(50 + adjBbPer100 * 2.5)

/** 全下平均 equity → 0–100（0.5≈50，0.7≈90） */
const scoreAvgEquity = (avgEq: number): number => clamp(avgEq * 100 + 10)

/**
 * L1 40%：去跑马战绩 + 全下平均 equity（样本少则降权 equity）
 * L2 30%：选牌合规 / limp 惩罚
 * L3 22%：红线「赚到的」占比 + 红线带符号健康度
 * L4 8%：打法健康度（默认满分；踩离谱规则则降低）
 */
export const skillFromCounters = (c: StyleCounters): SkillBreakdown => {
  const hands = Math.max(c.hands, 1)
  const adjBb100 = (c.allInAdjWagerBb / hands) * 100
  const avgEq =
    c.allInEquityCount > 0 ? c.allInEquitySum / c.allInEquityCount : null

  let skillL1: number
  if (avgEq == null) {
    // 无全下 equity 样本：不注入默认 55，纯看 Adj
    skillL1 = scoreAdjBb100(adjBb100)
  } else {
    // 样本越多 equity 权重越高，上限 0.3（满权约 20 手全下）
    const eqW = Math.min(0.3, (0.3 * Math.min(c.allInEquityCount, 20)) / 20)
    skillL1 = clamp(
      (1 - eqW) * scoreAdjBb100(adjBb100) + eqW * scoreAvgEquity(avgEq)
    )
  }

  // 合规率只用「已知洞牌的入池手」；无样本时给中性分，避免缺洞牌 → 全员 L2=0
  const chartRate =
    c.chartKnownVpipHands > 0
      ? c.chartOkVpipHands / c.chartKnownVpipHands
      : 0.55
  const limpRate = c.hands > 0 ? c.limpHands / c.hands : 0
  // 基线 15 + 合规主导 − limp 轻罚（原 limp×80 易把松池打到贴零）
  const skillL2 = clamp(15 + chartRate * 85 - limpRate * 45)

  // 只统计「正的」红/蓝贡献：负红线（弃牌大输）不再靠绝对值虚高
  const redPos = Math.max(c.redlineBb, 0)
  const bluePos = Math.max(c.bluelineBb, 0)
  const posDen = redPos + bluePos
  const redWinShare = posDen > 0 ? redPos / posDen : 0.5
  const structureScore = 40 + redWinShare * 60
  // 红线 bb/100 带符号：弃牌赢抬分、弃牌输压分
  const redBb100 = (c.redlineBb / hands) * 100
  const redSignedScore = clamp(50 + redBb100 * 1.5)
  const skillL3 = clamp(0.55 * structureScore + 0.45 * redSignedScore)

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
