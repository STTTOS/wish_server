import type { ScoreTier, NodeScoreResult, DecisionSnapshot } from './types'

import { TIER_SCORE, STRATEGY_VERSION_RULES_P0 } from './constants'

const potWeight = (s: DecisionSnapshot): number =>
  Math.max(0.25, Math.min(4, s.potBb / 5))

const streetWeight = (s: DecisionSnapshot): number => {
  if (s.street === 'river') return 1.35
  if (s.street === 'turn') return 1.15
  if (s.street === 'flop') return 1.05
  return 1
}

const result = (
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

/**
 * P0 规则评分：无洞牌。被迫行动 skip。
 * 覆盖：limp、位置偷盲、彩池赔率跟弃、PFR cbet、异常尺寸。
 */
export const scoreDecisionNode = (
  snapshot: DecisionSnapshot
): NodeScoreResult => {
  if (snapshot.isForced) {
    return result('skip', '被迫行动（盲注等）不评分', 'none', snapshot)
  }

  const { actionType, lineTag, street, potOdds, heroPosition } = snapshot

  // —— 翻前：未开池 limp ——
  if (
    street === 'preflop' &&
    lineTag === 'unopened' &&
    (actionType === 'call' ||
      (actionType === 'allIn' &&
        snapshot.toCallBb > 0 &&
        snapshot.toCallBb < 2.5))
  ) {
    // 冷跟开池额≈1bb 视为 limp
    if (snapshot.toCallBb > 0 && snapshot.toCallBb <= 1.5) {
      return result('mistake', '未开池 limp / 冷跟进池', 'line', snapshot)
    }
  }

  // —— 翻前：关位未开池加注（偷盲/开池）——
  if (
    street === 'preflop' &&
    lineTag === 'unopened' &&
    (actionType === 'raise' || actionType === 'bet' || actionType === 'allIn')
  ) {
    if (heroPosition === 'btn' || heroPosition === 'co') {
      return result('best', '关位未开池主动加注', 'aggression', snapshot)
    }
    if (heroPosition === 'sb') {
      return result('correct', 'SB 未开池加注', 'aggression', snapshot)
    }
    return result('correct', '未开池主动加注', 'aggression', snapshot)
  }

  // —— 翻前：关位未开池弃牌（错过偷盲）——
  if (
    street === 'preflop' &&
    lineTag === 'unopened' &&
    actionType === 'fold' &&
    (heroPosition === 'btn' || heroPosition === 'co')
  ) {
    return result(
      'inaccuracy',
      '关位折叠未开池底池（少偷盲）',
      'aggression',
      snapshot
    )
  }

  // —— 彩池赔率：无洞牌时的粗纪律 ——
  if (potOdds != null && (actionType === 'call' || actionType === 'allIn')) {
    // 价格很差（需很高胜率）仍跟 → 粘锅嫌疑
    if (potOdds >= 0.42) {
      return result(
        'mistake',
        `彩池赔率差仍跟注（potOdds=${potOdds.toFixed(2)}）`,
        'odds',
        snapshot
      )
    }
    if (potOdds >= 0.35) {
      return result(
        'inaccuracy',
        `偏贵跟注（potOdds=${potOdds.toFixed(2)}）`,
        'odds',
        snapshot
      )
    }
  }

  if (potOdds != null && actionType === 'fold' && potOdds <= 0.18) {
    return result(
      'inaccuracy',
      `价格很好仍弃牌（potOdds=${potOdds.toFixed(2)}）`,
      'odds',
      snapshot
    )
  }

  // —— 作为 PFR：翻牌 cbet / 过牌 ——
  if (street === 'flop' && lineTag === 'as_pfr' && snapshot.aggressorIsHero) {
    if (
      actionType === 'bet' ||
      actionType === 'raise' ||
      actionType === 'allIn'
    ) {
      if (snapshot.boardTexture === 'dry') {
        return result('best', '干面 PFR 持续下注', 'aggression', snapshot)
      }
      return result('correct', 'PFR 翻牌主动下注', 'aggression', snapshot)
    }
    if (actionType === 'check') {
      if (snapshot.boardTexture === 'dry') {
        return result(
          'inaccuracy',
          '干面 PFR 过牌放弃主动',
          'aggression',
          snapshot
        )
      }
      return result('correct', '湿面 PFR 过牌可接受', 'aggression', snapshot)
    }
  }

  // —— 尺寸：相对底池极端 ——
  if (
    (actionType === 'bet' || actionType === 'raise') &&
    snapshot.actionSizePotFrac != null
  ) {
    const f = snapshot.actionSizePotFrac
    if (f > 0 && f < 0.2) {
      return result('inaccuracy', '下注尺寸过小（相对底池）', 'size', snapshot)
    }
    if (f > 2.5) {
      return result('inaccuracy', '下注尺寸过大（相对底池）', 'size', snapshot)
    }
  }

  // —— 默认：中性可接受 ——
  if (actionType === 'fold' || actionType === 'check') {
    return result('correct', '常规过牌/弃牌', 'line', snapshot)
  }
  if (
    actionType === 'call' ||
    actionType === 'bet' ||
    actionType === 'raise' ||
    actionType === 'allIn'
  ) {
    return result('correct', '常规主动/跟注', 'line', snapshot)
  }

  return result('skip', '未识别行动', 'none', snapshot)
}
