import type { DisciplineProvider, DisciplineEvaluation } from './types'
import type { ScoreTier, NodeScoreResult, DecisionSnapshot } from '../types'

import { TIER_SCORE, DISCIPLINE_RULES_VERSION } from '../constants'

/** 大池漏洞权重更高；街权重弱化——纪律不按「后期技术含量」抬分 */
const potWeight = (s: DecisionSnapshot): number =>
  Math.max(0.25, Math.min(4, s.potBb / 5))

const nodeResult = (
  tier: ScoreTier,
  reason: string,
  dimension: NodeScoreResult['dimension'],
  snapshot: DecisionSnapshot
): NodeScoreResult => ({
  tier,
  score: TIER_SCORE[tier],
  weight: tier === 'skip' ? 0 : potWeight(snapshot),
  reason,
  rulesVersion: DISCIPLINE_RULES_VERSION,
  dimension
})

/**
 * 纪律规则 v1（只扣漏，不奖「好招」）：
 * - 未开池 limp / 冷跟
 * - 相对底池过贵仍跟注
 * - 下注尺寸极端偏小/偏大
 * 其余自愿行动视为干净（100）；被迫行动 skip。
 *
 * 刻意不做：偷盲奖励、c-bet 奖励、关位弃牌惩罚、便宜弃牌惩罚
 * （那些是技术/策略判断，无洞牌时也构不成纪律模型）。
 */
const evaluateDisciplineRules = (
  snapshot: DecisionSnapshot
): DisciplineEvaluation => {
  const wrap = (node: NodeScoreResult): DisciplineEvaluation => ({
    rulesVersion: DISCIPLINE_RULES_VERSION,
    node
  })

  if (snapshot.isForced) {
    return wrap(
      nodeResult('skip', '被迫行动（盲注等）不评分', 'none', snapshot)
    )
  }

  const { actionType, lineTag, street, potOdds } = snapshot

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
        nodeResult('hard_leak', '未开池 limp / 冷跟进池', 'limp', snapshot)
      )
    }
  }

  if (potOdds != null && (actionType === 'call' || actionType === 'allIn')) {
    if (potOdds >= 0.45) {
      return wrap(
        nodeResult(
          'severe',
          `彩池赔率很差仍跟注（potOdds=${potOdds.toFixed(2)}）`,
          'odds',
          snapshot
        )
      )
    }
    if (potOdds >= 0.38) {
      return wrap(
        nodeResult(
          'hard_leak',
          `彩池赔率差仍跟注（potOdds=${potOdds.toFixed(2)}）`,
          'odds',
          snapshot
        )
      )
    }
    if (potOdds >= 0.32) {
      return wrap(
        nodeResult(
          'soft_leak',
          `偏贵跟注（potOdds=${potOdds.toFixed(2)}）`,
          'odds',
          snapshot
        )
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
        nodeResult('soft_leak', '下注尺寸过小（相对底池）', 'size', snapshot)
      )
    }
    if (f > 2.5) {
      return wrap(
        nodeResult('soft_leak', '下注尺寸过大（相对底池）', 'size', snapshot)
      )
    }
  }

  return wrap(nodeResult('clean', '未见纪律漏洞', 'none', snapshot))
}

export const disciplineRulesProvider: DisciplineProvider = {
  id: DISCIPLINE_RULES_VERSION,
  evaluate: evaluateDisciplineRules
}
