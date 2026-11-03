export type DecisionStreet = 'preflop' | 'flop' | 'turn' | 'river'

export type DecisionActionType =
  | 'fold'
  | 'check'
  | 'call'
  | 'bet'
  | 'raise'
  | 'allIn'

/** 线路标签：不依赖洞牌 */
export type DecisionLineTag =
  | 'unopened'
  | 'vs_open'
  | 'vs_raise'
  | 'as_pfr'
  | 'vs_cbet'
  | 'vs_bet'
  | 'other'

export type HeroPositionBucket =
  | 'btn'
  | 'co'
  | 'mp'
  | 'ep'
  | 'sb'
  | 'bb'
  | 'unknown'

/** 纪律档位：干净 / 轻漏 / 硬漏 / 严重 / 不评分 */
export type ScoreTier = 'clean' | 'soft_leak' | 'hard_leak' | 'severe' | 'skip'

/**
 * 行动快照（纪律评分契约）。不含洞牌 / 公牌纹理 / SPR 等技术向字段。
 */
export type DecisionSnapshot = {
  matchId: number
  userId: number
  actionIndex: number
  schemaVersion: number

  street: DecisionStreet
  playersInHand: number
  heroPosition: HeroPositionBucket
  potBb: number
  toCallBb: number
  lineTag: DecisionLineTag

  actionType: DecisionActionType
  /** 本行动投入的增量 bb（call/bet/raise/allIn）；fold/check 为 0 */
  actionSizeBb: number
  /** 相对行动前底池；非下注类为 null */
  actionSizePotFrac: number | null
  isForced: boolean

  /** toCall/(pot+toCall)；可过牌时 null */
  potOdds: number | null
}

export type NodeScoreResult = {
  tier: ScoreTier
  /** skip 时为 null */
  score: number | null
  weight: number
  reason: string
  rulesVersion: string
  dimension: 'limp' | 'odds' | 'size' | 'none'
}

export type HandDisciplineAggregate = {
  handDiscipline: number | null
  scoredNodes: number
  skippedNodes: number
  totalWeight: number
}

export type HabitSignals = {
  /** 0–100，越高越守纪律；由频率类习惯漏洞推导 */
  habitScore: number
}
