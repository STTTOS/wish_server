import type { NodeScoreResult, DecisionSnapshot } from './types'

import { type StrategyEvaluation, getActiveStrategyProvider } from './strategy'

/**
 * 对单个决策快照评分。
 * 委托当前 StrategyProvider（P0 规则 / 未来 blueprint·solver）。
 */
export const evaluateDecisionNode = (
  snapshot: DecisionSnapshot
): StrategyEvaluation => getActiveStrategyProvider().evaluate(snapshot)

/** @deprecated 兼容旧名；新代码请用 evaluateDecisionNode */
export const scoreDecisionNode = (
  snapshot: DecisionSnapshot
): NodeScoreResult => evaluateDecisionNode(snapshot).node
