import type {
  NodeScoreResult,
  StructureSignals,
  HandTechAggregate
} from './types'

import { TECH_WEIGHTS } from './constants'

/** 单手：可评分节点加权平均 */
export const aggregateHandTech = (
  nodes: NodeScoreResult[]
): HandTechAggregate => {
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
    handTech: wSum > 0 ? sSum / wSum : null,
    scoredNodes,
    skippedNodes,
    totalWeight: wSum
  }
}

/** 跨手：HandTech 等权平均（忽略 null 手） */
export const aggregatePlayerTechFromHands = (
  handTeches: Array<number | null>
): number | null => {
  const xs = handTeches.filter(
    (x): x is number => x != null && Number.isFinite(x)
  )
  if (!xs.length) return null
  return xs.reduce((a, b) => a + b, 0) / xs.length
}

/**
 * 最终 PlayerTech = 决策聚合 × w_d + 结构分 × w_s
 */
export const combinePlayerTech = (
  decisionTech: number | null,
  structure: StructureSignals
): number | null => {
  if (decisionTech == null) return null
  const s = Math.max(0, Math.min(100, structure.structureScore))
  return TECH_WEIGHTS.decision * decisionTech + TECH_WEIGHTS.structure * s
}

/**
 * 结构分：由已有频率信号推导（不读洞牌）。
 * 输入为 0–1 风险项，越高越差。
 */
export const structureScoreFromSignals = (input: {
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
