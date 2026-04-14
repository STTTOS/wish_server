import type { Poke } from 'texas-poker-core'

import { ranks, suits } from 'texas-poker-core'

/**
 * 手牌分布审计：检验参数、牌面全集与类型（与 `handPokeAuditService` 强绑定）。
 * 分页等系统级配置见 `constants/pagination.ts`。
 */

/** 有效两手牌记录达到该条数后才做 χ² 检验（对应约 300 张底牌） */
export const HAND_POKE_AUDIT_MIN_VALID_HANDS = 150

/** 52 种牌面，均匀假设下自由度为 51 */
export const HAND_POKE_AUDIT_CATEGORY_COUNT = 52
export const HAND_POKE_AUDIT_DF = HAND_POKE_AUDIT_CATEGORY_COUNT - 1

/** p 值低于该阈值判为 abnormal */
export const HAND_POKE_AUDIT_ALPHA = 0.05

const built: Poke[] = []
for (const s of suits) {
  for (const r of ranks) {
    built.push(`${s}${r}` as Poke)
  }
}

/** 全序列表：h2, h3, …, ca（与 core 的 Suit+Rank 一致） */
export const ALL_POKE_LIST: readonly Poke[] = built

const pokeKeySet = new Set<string>(built as string[])

export function isPokeLabel(s: string): s is Poke {
  return pokeKeySet.has(s)
}

export const HandPokeAuditStatus = {
  insufficient_data: 'insufficient_data',
  normal: 'normal',
  abnormal: 'abnormal'
} as const

export type HandPokeAuditStatusType =
  (typeof HandPokeAuditStatus)[keyof typeof HandPokeAuditStatus]
