import type { NodeScoreResult, DecisionSnapshot } from '../types'

/**
 * 纪律规则对「已发生行动」的评估。
 * 抽象：纪律分 ∝ 少犯可观察的过程漏洞（limp / 贵跟 / 极端尺寸等），
 * 不评价是否 GTO、不奖励积极进攻。
 */
export type DisciplineEvaluation = {
  rulesVersion: string
  node: NodeScoreResult
}

export type DisciplineProvider = {
  readonly id: string
  evaluate: (snapshot: DecisionSnapshot) => DisciplineEvaluation
}
