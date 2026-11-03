/**
 * 牌风口径版本；变更须 bump 并跑 backfill:style-stats
 * v7：去掉洞牌 chart 计数与 L1–L4；纪律分见 PlayerDisciplineStat
 */
export const STYLE_STATS_VERSION = 7

/** 雷达灰显门槛 */
export const RADAR_MIN_HANDS = 50

export const STYLE_SCOPE_ALL = 'all' as const
