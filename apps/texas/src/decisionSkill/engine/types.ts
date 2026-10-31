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

export type ScoreTier =
  | 'best'
  | 'correct'
  | 'inaccuracy'
  | 'mistake'
  | 'blunder'
  | 'skip'

/**
 * 决策快照（评分契约）。不含洞牌 / equity / outs。
 * 落库与纯函数引擎共用此形状。
 */
export type DecisionSnapshot = {
  matchId: number
  userId: number
  actionIndex: number
  schemaVersion: number

  street: DecisionStreet
  playersInHand: number
  heroPosition: HeroPositionBucket
  heroStackBb: number
  potBb: number
  toCallBb: number
  spr: number | null
  boardPokes: string[]
  /** dry | semi | wet | unknown */
  boardTexture: 'dry' | 'semi' | 'wet' | 'unknown'
  lineTag: DecisionLineTag
  aggressorIsHero: boolean

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
  strategyVersion: string
  dimension: 'line' | 'odds' | 'aggression' | 'size' | 'none'
}

export type HandTechAggregate = {
  handTech: number | null
  scoredNodes: number
  skippedNodes: number
  totalWeight: number
}

export type StructureSignals = {
  /** 0–100，越高越好；由频率类漏洞推导 */
  structureScore: number
}
