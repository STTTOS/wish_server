/**
 * 牌风口径版本；变更须 bump 并跑 backfill:style-stats
 * v7：去掉洞牌 chart 计数与 L1–L4 skill 缓存（技术分 → PlayerTechStat）
 */
export const STYLE_STATS_VERSION = 7

/** @deprecated 技术样本门槛见 decisionSkill TECH_SAMPLE_HANDS */
export const SKILL_SAMPLE_HANDS = 50

/** 雷达灰显门槛 */
export const RADAR_MIN_HANDS = 50

export const STYLE_SCOPE_ALL = 'all' as const
