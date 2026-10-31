/**
 * 牌风口径版本；变更须 bump 并跑 backfill:style-stats
 * v2 排除贴盲；v3 摊牌/27o；v4 AFq 不含 fold；v5 L2 已知洞牌分母+软化
 */
export const STYLE_STATS_VERSION = 5

/** 技术分 / 全站 skill 均值纳入门槛（手数） */
export const SKILL_SAMPLE_HANDS = 50

/** 雷达灰显门槛 */
export const RADAR_MIN_HANDS = 50

/** 技术分权重（定稿） */
export const SKILL_WEIGHTS = {
  l1: 0.4,
  l2: 0.3,
  l3: 0.22,
  l4: 0.08
} as const

export const STYLE_SCOPE_ALL = 'all' as const
