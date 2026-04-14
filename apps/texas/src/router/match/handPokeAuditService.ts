import type { Poke } from 'texas-poker-core'

import { chiSquareUpperTailPValue } from '../../utils/chiSquareUpperTailPValue'
import {
  isPokeLabel,
  ALL_POKE_LIST,
  HAND_POKE_AUDIT_DF,
  HandPokeAuditStatus,
  HAND_POKE_AUDIT_ALPHA,
  type HandPokeAuditStatusType,
  HAND_POKE_AUDIT_CATEGORY_COUNT,
  HAND_POKE_AUDIT_MIN_VALID_HANDS
} from './handPokeAuditConstants'

/** 仅详情：带期望与 Pearson 残差，供前端热力/渐变着色 */
export type PokeDistributionItem = {
  poke: Poke
  count: number
  /** 均匀假设下该牌期望出现次数，= cardCount / 52 */
  expectedCount: number
  /**
   * Pearson 残差 (O−E)/√E；单格对总 χ² 的贡献为 residual²。
   * 大样本下 |r|≈2 常作略偏、|r|≈3 作很偏（探索性，非独立）。
   */
  pearsonResidual: number | null
}

function isValidTwoCardHand(raw: unknown): raw is [Poke, Poke] {
  if (!Array.isArray(raw) || raw.length !== 2) return false
  const a = raw[0]
  const b = raw[1]
  if (typeof a !== 'string' || typeof b !== 'string') return false
  if (!isPokeLabel(a) || !isPokeLabel(b)) return false
  if (a === b) return false
  return true
}

/**
 * 从全站 `playerMatchRecord.handPokes` 行聚合审计统计（仅统计有效两手记录）。
 */
export function aggregateHandPokeAuditFromRows(
  rows: ReadonlyArray<{ handPokes: unknown }>
): {
  validHandCount: number
  totalValidCards: number
  countsByPoke: Map<Poke, number>
  auditStatus: HandPokeAuditStatusType
  chiSquare: number | null
  pValue: number | null
  /** 与 χ² 可算条件一致：有效手数 ≥ 最少手数 */
  heatmapScaleEnabled: boolean
} {
  const countsByPoke = new Map<Poke, number>()
  for (const p of ALL_POKE_LIST) {
    countsByPoke.set(p, 0)
  }

  let validHandCount = 0
  for (const row of rows) {
    if (!isValidTwoCardHand(row.handPokes)) continue
    validHandCount += 1
    const [c0, c1] = row.handPokes
    countsByPoke.set(c0, (countsByPoke.get(c0) ?? 0) + 1)
    countsByPoke.set(c1, (countsByPoke.get(c1) ?? 0) + 1)
  }

  const totalValidCards = validHandCount * 2
  const heatmapScaleEnabled = validHandCount >= HAND_POKE_AUDIT_MIN_VALID_HANDS

  if (validHandCount < HAND_POKE_AUDIT_MIN_VALID_HANDS) {
    return {
      validHandCount,
      totalValidCards,
      countsByPoke,
      auditStatus: HandPokeAuditStatus.insufficient_data,
      chiSquare: null,
      pValue: null,
      heatmapScaleEnabled
    }
  }

  const expected = totalValidCards / HAND_POKE_AUDIT_CATEGORY_COUNT
  let chiSq = 0
  for (const poke of ALL_POKE_LIST) {
    const o = countsByPoke.get(poke) ?? 0
    const diff = o - expected
    chiSq += (diff * diff) / expected
  }

  const pValue = chiSquareUpperTailPValue(chiSq, HAND_POKE_AUDIT_DF)
  const auditStatus =
    pValue < HAND_POKE_AUDIT_ALPHA
      ? HandPokeAuditStatus.abnormal
      : HandPokeAuditStatus.normal

  return {
    validHandCount,
    totalValidCards,
    countsByPoke,
    auditStatus,
    chiSquare: chiSq,
    pValue,
    heatmapScaleEnabled
  }
}

/**
 * 详情用：每张牌的期望次数与 Pearson 残差（与总 χ² 同一套 E）。
 * `totalValidCards === 0` 时残差为 null。
 */
export function pokeDistributionDetailItems(
  countsByPoke: Map<Poke, number>,
  totalValidCards: number
): PokeDistributionItem[] {
  if (totalValidCards <= 0) {
    return ALL_POKE_LIST.map((poke) => ({
      poke,
      count: countsByPoke.get(poke) ?? 0,
      expectedCount: 0,
      pearsonResidual: null
    }))
  }

  const expected = totalValidCards / HAND_POKE_AUDIT_CATEGORY_COUNT
  const sqrtE = Math.sqrt(expected)

  return ALL_POKE_LIST.map((poke) => {
    const o = countsByPoke.get(poke) ?? 0
    const pearsonResidual = sqrtE > 0 ? (o - expected) / sqrtE : null
    return {
      poke,
      count: o,
      expectedCount: expected,
      pearsonResidual
    }
  })
}
