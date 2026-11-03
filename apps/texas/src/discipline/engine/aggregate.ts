import type {
  HabitSignals,
  NodeScoreResult,
  HandDisciplineAggregate
} from './types'

import { DISCIPLINE_WEIGHTS } from './constants'

/** 单手：可评分节点加权平均 */
export const aggregateHandDiscipline = (
  nodes: NodeScoreResult[]
): HandDisciplineAggregate => {
  let scoredNodes = 0
  let skippedNodes = 0
  let wSum = 0
  let sSum = 0
  for (const n of nodes) {
    if (n.score == null || n.tier === 'skip' || n.weight <= 0) {
      skippedNodes += 1
      continue
    }
    scoredNodes += 1
    wSum += n.weight
    sSum += n.score * n.weight
  }
  return {
    handDiscipline: wSum > 0 ? sSum / wSum : null,
    scoredNodes,
    skippedNodes,
    totalWeight: wSum
  }
}

/** 跨手：HandDiscipline 等权平均（忽略 null 手） */
export const aggregatePlayerActionDiscipline = (
  handScores: Array<number | null>
): number | null => {
  const xs = handScores.filter(
    (x): x is number => x != null && Number.isFinite(x)
  )
  if (!xs.length) return null
  return xs.reduce((a, b) => a + b, 0) / xs.length
}

/**
 * 最终纪律分 = 行动纪律 × w_a + 习惯纪律 × w_h
 */
export const combineDisciplineScore = (
  actionDiscipline: number | null,
  habit: HabitSignals
): number | null => {
  if (actionDiscipline == null) return null
  const h = Math.max(0, Math.min(100, habit.habitScore))
  return (
    DISCIPLINE_WEIGHTS.action * actionDiscipline + DISCIPLINE_WEIGHTS.habit * h
  )
}

/**
 * 习惯纪律：由频率信号推导（不读洞牌）。
 * 输入为风险项，越高越差。
 */
export const habitScoreFromSignals = (input: {
  limpRate: number
  highVpip: boolean
  callingStation: boolean
  lowPfrRatio: boolean
}): number => {
  let score = 100
  if (input.limpRate >= 0.2) score -= 25
  else if (input.limpRate >= 0.1) score -= 12
  if (input.highVpip) score -= 20
  if (input.callingStation) score -= 25
  if (input.lowPfrRatio) score -= 15
  return Math.max(0, Math.min(100, score))
}
