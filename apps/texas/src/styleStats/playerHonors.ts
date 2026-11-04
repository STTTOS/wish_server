import type { Prisma, RankCategory } from '@prisma/texas-client'

import { logger } from '../logger'
import prisma, { playerHonorsStat, playerMatchRecord } from '../models'

export type PlayerHonorsDto = {
  /** 参与手数（PlayerMatchRecord 行数） */
  hands: number
  royalFlushCount: number
  straightFlushCount: number
  fourOfKindCount: number
}

type Tx = Prisma.TransactionClient

export type HonorSeatDelta = {
  userId: number
  isFold: boolean
  rankCategory: RankCategory | null
}

export type HonorCounters = {
  hands: number
  royalFlushCount: number
  straightFlushCount: number
  fourOfKindCount: number
}

/** 单座一手对荣誉计数的增量（与旧 getPlayerHonors 口径一致） */
export const honorDeltaForSeat = (seat: HonorSeatDelta): HonorCounters => {
  const d: HonorCounters = {
    hands: 1,
    royalFlushCount: 0,
    straightFlushCount: 0,
    fourOfKindCount: 0
  }
  if (!seat.isFold) {
    if (seat.rankCategory === 'z') d.royalFlushCount = 1
    if (seat.rankCategory === 'y') d.straightFlushCount = 1
    if (seat.rankCategory === 'x') d.fourOfKindCount = 1
  }
  return d
}

/** 一手内按 user 合并增量后 upsert 物化表 */
export const applyHandHonorsDeltas = async (
  tx: Tx,
  args: { matchId: number; seats: HonorSeatDelta[] }
) => {
  const byUser = new Map<number, HonorCounters>()
  for (const seat of args.seats) {
    const delta = honorDeltaForSeat(seat)
    const prev = byUser.get(seat.userId)
    if (prev == null) {
      byUser.set(seat.userId, { ...delta })
      continue
    }
    prev.hands += delta.hands
    prev.royalFlushCount += delta.royalFlushCount
    prev.straightFlushCount += delta.straightFlushCount
    prev.fourOfKindCount += delta.fourOfKindCount
  }

  for (const [userId, d] of byUser) {
    await tx.playerHonorsStat.upsert({
      where: { userId },
      create: {
        userId,
        hands: d.hands,
        royalFlushCount: d.royalFlushCount,
        straightFlushCount: d.straightFlushCount,
        fourOfKindCount: d.fourOfKindCount,
        lastMatchId: args.matchId
      },
      update: {
        hands: { increment: d.hands },
        royalFlushCount: { increment: d.royalFlushCount },
        straightFlushCount: { increment: d.straightFlushCount },
        fourOfKindCount: { increment: d.fourOfKindCount },
        lastMatchId: args.matchId
      }
    })
  }
}

/**
 * 公开荣誉统计：读物化表（O(1)）。
 * 大牌成就仅计未弃牌手（与历史 match/overview 一致）。
 */
export const getPlayerHonors = async (
  userId: number
): Promise<PlayerHonorsDto> => {
  const row = await playerHonorsStat.findUnique({ where: { userId } })
  if (row == null) {
    return {
      hands: 0,
      royalFlushCount: 0,
      straightFlushCount: 0,
      fourOfKindCount: 0
    }
  }
  return {
    hands: row.hands,
    royalFlushCount: row.royalFlushCount,
    straightFlushCount: row.straightFlushCount,
    fourOfKindCount: row.fourOfKindCount
  }
}

/**
 * 从 PlayerMatchRecord 全量重建荣誉物化（上线/纠偏用）。
 * 不依赖 style 已应用标记。
 */
export const rebuildPlayerHonorsFromRecords = async (opts?: {
  batchSize?: number
  clearFirst?: boolean
}) => {
  const batchSize = opts?.batchSize ?? 2000
  const clearFirst = opts?.clearFirst ?? true

  if (clearFirst) {
    await prisma.playerHonorsStat.deleteMany({})
    logger.info('[playerHonors] cleared player_honors_stat')
  }

  const totals = new Map<number, HonorCounters>()
  let cursor = 0
  let scanned = 0

  for (;;) {
    const rows = await playerMatchRecord.findMany({
      where: { id: { gt: cursor } },
      orderBy: { id: 'asc' },
      take: batchSize,
      select: {
        id: true,
        userId: true,
        isFold: true,
        rankCategory: true
      }
    })
    if (rows.length === 0) break

    for (const r of rows) {
      const delta = honorDeltaForSeat({
        userId: r.userId,
        isFold: r.isFold,
        rankCategory: r.rankCategory
      })
      const prev = totals.get(r.userId)
      if (prev == null) {
        totals.set(r.userId, { ...delta })
      } else {
        prev.hands += delta.hands
        prev.royalFlushCount += delta.royalFlushCount
        prev.straightFlushCount += delta.straightFlushCount
        prev.fourOfKindCount += delta.fourOfKindCount
      }
      cursor = r.id
      scanned += 1
    }
    logger.info(
      `[playerHonors] scan progress cursor=${cursor} scanned=${scanned} users=${totals.size}`
    )
  }

  let written = 0
  for (const [userId, d] of totals) {
    await playerHonorsStat.create({
      data: {
        userId,
        hands: d.hands,
        royalFlushCount: d.royalFlushCount,
        straightFlushCount: d.straightFlushCount,
        fourOfKindCount: d.fourOfKindCount
      }
    })
    written += 1
  }

  logger.info(`[playerHonors] rebuild done scanned=${scanned} users=${written}`)
  return { scanned, users: written }
}
