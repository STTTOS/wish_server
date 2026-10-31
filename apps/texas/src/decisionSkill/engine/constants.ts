/** 决策快照字段版本（与落库 schemaVersion 对齐） */
export const DECISION_SNAPSHOT_SCHEMA_VERSION = 1

/** P0 规则策略版本 */
export const STRATEGY_VERSION_RULES_P0 = 'rules-p0-v1'

/** 技术分聚合版本（雷达 / 榜） */
export const PLAYER_TECH_VERSION = 1

/** 玩家技术分样本门槛（有效手数） */
export const TECH_SAMPLE_HANDS = 50

/** 节点分档 → 0–100 分 */
export const TIER_SCORE = {
  best: 100,
  correct: 85,
  inaccuracy: 65,
  mistake: 40,
  blunder: 15,
  skip: null as number | null
} as const

/** 技术分：决策 vs 结构（无结果层） */
export const TECH_WEIGHTS = {
  decision: 0.8,
  structure: 0.2
} as const
