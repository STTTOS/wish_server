import prisma from '../models'
import { logger } from '../logger'
import { STYLE_STATS_VERSION } from './engine'
import { applyStyleStatsForHand } from './applyStyleStatsForHand'

/**
 * 清空物化表后按 matchId 游标全量回填（statsVersion 重建用）。
 */
export const rebuildStyleStatsFromMatches = async (opts?: {
  batchSize?: number
  clearFirst?: boolean
}) => {
  const batchSize = opts?.batchSize ?? 50
  const clearFirst = opts?.clearFirst ?? true

  if (clearFirst) {
    await prisma.playerStyleStat.deleteMany({})
    await prisma.stylePopulationStat.deleteMany({})
    logger.info(
      '[styleStats] cleared player_style_stat / style_population_stat'
    )
  }

  let cursor = 0
  let processed = 0
  for (;;) {
    const rows = await prisma.match.findMany({
      where: {
        id: { gt: cursor },
        endedAt: { not: null }
      },
      orderBy: { id: 'asc' },
      take: batchSize,
      select: { id: true }
    })
    if (rows.length === 0) break

    for (const row of rows) {
      try {
        await applyStyleStatsForHand(row.id)
        processed += 1
      } catch (err) {
        logger.error(`[styleStats] backfill matchId=${row.id} failed`, err)
      }
      cursor = row.id
    }
    logger.info(
      `[styleStats] backfill progress cursor=${cursor} processed=${processed} version=${STYLE_STATS_VERSION}`
    )
  }

  return { processed, statsVersion: STYLE_STATS_VERSION }
}
