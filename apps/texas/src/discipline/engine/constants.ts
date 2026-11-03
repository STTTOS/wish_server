/** 行动快照字段版本（与落库 schemaVersion 对齐；v2 去掉纹理/SPR/aggressor） */
export const DISCIPLINE_SNAPSHOT_SCHEMA_VERSION = 2

/** 纪律规则版本（改规则须 bump，并建议全量 backfill） */
export const DISCIPLINE_RULES_VERSION = 'discipline-rules-v1'

/** 用户纪律分物化版本 */
export const PLAYER_DISCIPLINE_VERSION = 2

/** 玩家纪律分样本门槛（有效评分手数） */
export const DISCIPLINE_SAMPLE_HANDS = 50

/**
 * 节点档位 → 0–100。
 * 纪律分是「扣漏洞」模型：干净行动满分；不因积极/标准线路加分。
 */
export const TIER_SCORE = {
  clean: 100,
  soft_leak: 70,
  hard_leak: 40,
  severe: 15,
  skip: null as number | null
} as const

/** 纪律分：行动纪律 vs 习惯纪律 */
export const DISCIPLINE_WEIGHTS = {
  action: 0.7,
  habit: 0.3
} as const
