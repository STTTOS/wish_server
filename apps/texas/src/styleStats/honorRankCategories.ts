import type { RankCategory } from '@prisma/texas-client'

import { type Poke, getBestPokesRankSignature } from 'texas-poker-core'

export const parseHonorPokes = (raw: unknown): string[] => {
  if (!Array.isArray(raw)) return []
  return raw.filter((x): x is string => typeof x === 'string')
}

export const rankCategoryFromHandAndBoard = (
  handPokes: string[],
  boardPokes: string[]
): RankCategory | null => {
  if (handPokes.length < 2 || boardPokes.length < 3) return null
  try {
    const sig = getBestPokesRankSignature(
      [handPokes as Poke[]],
      boardPokes as Poke[]
    )
    if (typeof sig !== 'string' || sig.length === 0) return null
    return sig[0] as RankCategory
  } catch {
    return null
  }
}

/** 从落库 `settlementRuns[].seats` 取某用户各跑牌型（按 run 顺序）。 */
export const ranksFromSettlementRunSeats = (
  settlementRuns: unknown,
  userId: number
): RankCategory[] => {
  if (!Array.isArray(settlementRuns)) return []
  const out: RankCategory[] = []
  for (const row of settlementRuns) {
    if (row == null || typeof row !== 'object') continue
    const seats = (row as { seats?: unknown }).seats
    if (!Array.isArray(seats)) continue
    let hit: RankCategory | null = null
    for (const s of seats) {
      if (s == null || typeof s !== 'object') continue
      const uid = Number((s as { userId?: unknown }).userId)
      if (uid !== userId) continue
      const rc = (s as { rankCategory?: unknown }).rankCategory
      if (typeof rc === 'string' && rc.length > 0) {
        hit = rc as RankCategory
      }
      break
    }
    if (hit != null) out.push(hit)
  }
  return out
}

/**
 * 荣誉 / 成就解锁用的本手牌型列表。
 * - 弃牌：空
 * - 双跑：每跑各计一次（优先 `settlementRuns[].seats`；缺则手牌+两跑公牌现算）
 * - 单跑：`fallbackRank`
 */
export const resolveHonorRankCategories = (args: {
  isFold: boolean
  userId: number
  fallbackRank: RankCategory | null | undefined
  handPokes: string[]
  runCount?: number | null
  commonPokes?: unknown
  commonPokesRun2?: unknown
  settlementRuns?: unknown
}): RankCategory[] => {
  if (args.isFold) return []
  if (args.runCount === 2) {
    const fromSeats = ranksFromSettlementRunSeats(
      args.settlementRuns,
      args.userId
    )
    if (fromSeats.length > 0) return fromSeats

    const hand = args.handPokes
    const ranks: RankCategory[] = []
    const r1 = rankCategoryFromHandAndBoard(
      hand,
      parseHonorPokes(args.commonPokes)
    )
    const r2 = rankCategoryFromHandAndBoard(
      hand,
      parseHonorPokes(args.commonPokesRun2)
    )
    if (r1 != null) ranks.push(r1)
    if (r2 != null) ranks.push(r2)
    if (ranks.length > 0) return ranks
  }
  return args.fallbackRank != null ? [args.fallbackRank] : []
}
