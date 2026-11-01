import type {
  NodeScoreResult,
  DecisionSnapshot,
  DecisionActionType
} from '../types'

/**
 * 策略推荐的一条行动（终局形态：与「最优解」对齐）。
 * P0 规则引擎可不填；blueprint/solver 填 frequency / ev。
 */
export type RecommendedAction = {
  actionType: DecisionActionType
  /** 建议尺寸（bb）；过牌/弃牌可省略 */
  sizeBb?: number
  /** 混合策略频率 0–1；纯策略为 1 */
  frequency?: number
  /** 相对该节点的 EV（bb）；有 solver 时 */
  evBb?: number
}

/**
 * 策略模块对「已发生行动」的评估。
 *
 * 抽象目标（产品）：
 *   技术分 ∝ 玩家行动与最优行动集合的重合度（或 1 - 归一化 EV loss）
 *
 * P0：用规则档位近似重合度；P1+：用 recommendations + congruence/evLoss。
 */
export type StrategyEvaluation = {
  strategyVersion: string
  source: 'rules' | 'blueprint' | 'solver'
  /** 落库 / 聚合用的节点分（与现 NodeScoreResult 对齐） */
  node: NodeScoreResult
  /**
   * 与最优解重合度 0–1；skip 时 null。
   * 约定：1=完全合最优主线，0=相对最优最差一档。
   */
  congruence: number | null
  /** 相对最优的 EV 损失（bb）；无引擎时 null */
  evLossBb?: number | null
  /** 策略认为的可接受/最优行动（供解释与未来 UI） */
  recommendations?: RecommendedAction[]
}

/**
 * 可替换策略提供者：只依赖快照，不碰 DB。
 * 未来可注入带洞牌/范围的 Snapshot 扩展字段而不改编排层。
 */
export type StrategyProvider = {
  readonly id: string
  evaluate: (snapshot: DecisionSnapshot) => StrategyEvaluation
}
