import type { StrategyProvider, StrategyEvaluation } from './types'
import type { ScoreTier, NodeScoreResult, DecisionSnapshot } from '../types'

import { TIER_SCORE, STRATEGY_VERSION_RULES_P0 } from '../constants'

const potWeight = (s: DecisionSnapshot): number =>
  Math.max(0.25, Math.min(4, s.potBb / 5))

const streetWeight = (s: DecisionSnapshot): number => {
  if (s.street === 'river') return 1.35
  if (s.street === 'turn') return 1.15
  if (s.street === 'flop') return 1.05
  return 1
}

const nodeResult = (
  tier: ScoreTier,
  reason: string,
  dimension: NodeScoreResult['dimension'],
  snapshot: DecisionSnapshot
): NodeScoreResult => ({
  tier,
  score: TIER_SCORE[tier],
  weight: tier === 'skip' ? 0 : potWeight(snapshot) * streetWeight(snapshot),
  reason,
  strategyVersion: STRATEGY_VERSION_RULES_P0,
  dimension
})

/** 档位 → 重合度近似（与 TIER_SCORE/100 一致） */
const congruenceFromTier = (tier: ScoreTier): number | null => {
  const s = TIER_SCORE[tier]
  return s == null ? null : s / 100
}

const evaluateRulesP0 = (snapshot: DecisionSnapshot): StrategyEvaluation => {
  const wrap = (node: NodeScoreResult): StrategyEvaluation => ({
    strategyVersion: STRATEGY_VERSION_RULES_P0,
    source: 'rules',
    node,
    congruence: congruenceFromTier(node.tier),
    evLossBb: null,
    recommendations: undefined
  })

  if (snapshot.isForced) {
    return wrap(
      nodeResult('skip', '被迫行动（盲注等）不评分', 'none', snapshot)
    )
  }

  const { actionType, lineTag, street, potOdds, heroPosition } = snapshot

  if (
    street === 'preflop' &&
    lineTag === 'unopened' &&
    (actionType === 'call' ||
      (actionType === 'allIn' &&
        snapshot.toCallBb > 0 &&
        snapshot.toCallBb < 2.5))
  ) {
    if (snapshot.toCallBb > 0 && snapshot.toCallBb <= 1.5) {
      return wrap(
        nodeResult('mistake', '未开池 limp / 冷跟进池', 'line', snapshot)
      )
    }
  }

  if (
    street === 'preflop' &&
    lineTag === 'unopened' &&
    (actionType === 'raise' || actionType === 'bet' || actionType === 'allIn')
  ) {
    if (heroPosition === 'btn' || heroPosition === 'co') {
      return wrap(
        nodeResult('best', '关位未开池主动加注', 'aggression', snapshot)
      )
    }
    if (heroPosition === 'sb') {
      return wrap(
        nodeResult('correct', 'SB 未开池加注', 'aggression', snapshot)
      )
    }
    return wrap(nodeResult('correct', '未开池主动加注', 'aggression', snapshot))
  }

  if (
    street === 'preflop' &&
    lineTag === 'unopened' &&
    actionType === 'fold' &&
    (heroPosition === 'btn' || heroPosition === 'co')
  ) {
    return wrap(
      nodeResult(
        'inaccuracy',
        '关位折叠未开池底池（少偷盲）',
        'aggression',
        snapshot
      )
    )
  }

  // P0：仅用 potOdds 价格纪律（未结合手牌/补牌）；后续 Provider 可替换
  if (potOdds != null && (actionType === 'call' || actionType === 'allIn')) {
    if (potOdds >= 0.42) {
      return wrap(
        nodeResult(
          'mistake',
          `彩池赔率差仍跟注（potOdds=${potOdds.toFixed(2)}）`,
          'odds',
          snapshot
        )
      )
    }
    if (potOdds >= 0.35) {
      return wrap(
        nodeResult(
          'inaccuracy',
          `偏贵跟注（potOdds=${potOdds.toFixed(2)}）`,
          'odds',
          snapshot
        )
      )
    }
  }

  if (potOdds != null && actionType === 'fold' && potOdds <= 0.18) {
    return wrap(
      nodeResult(
        'inaccuracy',
        `价格很好仍弃牌（potOdds=${potOdds.toFixed(2)}）`,
        'odds',
        snapshot
      )
    )
  }

  if (street === 'flop' && lineTag === 'as_pfr' && snapshot.aggressorIsHero) {
    if (
      actionType === 'bet' ||
      actionType === 'raise' ||
      actionType === 'allIn'
    ) {
      if (snapshot.boardTexture === 'dry') {
        return wrap(
          nodeResult('best', '干面 PFR 持续下注', 'aggression', snapshot)
        )
      }
      return wrap(
        nodeResult('correct', 'PFR 翻牌主动下注', 'aggression', snapshot)
      )
    }
    if (actionType === 'check') {
      if (snapshot.boardTexture === 'dry') {
        return wrap(
          nodeResult(
            'inaccuracy',
            '干面 PFR 过牌放弃主动',
            'aggression',
            snapshot
          )
        )
      }
      return wrap(
        nodeResult('correct', '湿面 PFR 过牌可接受', 'aggression', snapshot)
      )
    }
  }

  if (
    (actionType === 'bet' || actionType === 'raise') &&
    snapshot.actionSizePotFrac != null
  ) {
    const f = snapshot.actionSizePotFrac
    if (f > 0 && f < 0.2) {
      return wrap(
        nodeResult('inaccuracy', '下注尺寸过小（相对底池）', 'size', snapshot)
      )
    }
    if (f > 2.5) {
      return wrap(
        nodeResult('inaccuracy', '下注尺寸过大（相对底池）', 'size', snapshot)
      )
    }
  }

  if (actionType === 'fold' || actionType === 'check') {
    return wrap(nodeResult('correct', '常规过牌/弃牌', 'line', snapshot))
  }
  if (
    actionType === 'call' ||
    actionType === 'bet' ||
    actionType === 'raise' ||
    actionType === 'allIn'
  ) {
    return wrap(nodeResult('correct', '常规主动/跟注', 'line', snapshot))
  }

  return wrap(nodeResult('skip', '未识别行动', 'none', snapshot))
}

/** P0 规则策略：公开信息纪律近似「与经验最优的重合度」 */
export const rulesP0StrategyProvider: StrategyProvider = {
  id: STRATEGY_VERSION_RULES_P0,
  evaluate: evaluateRulesP0
}
