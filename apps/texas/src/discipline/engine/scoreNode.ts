import type { NodeScoreResult, DecisionSnapshot } from './types'

import { getActiveDisciplineProvider } from './strategy'

/** 委托当前纪律规则 Provider */
export const evaluateDisciplineNode = (snapshot: DecisionSnapshot) =>
  getActiveDisciplineProvider().evaluate(snapshot)

/** 仅返回节点分（落库 / 聚合） */
export const scoreDisciplineNode = (
  snapshot: DecisionSnapshot
): NodeScoreResult => evaluateDisciplineNode(snapshot).node
