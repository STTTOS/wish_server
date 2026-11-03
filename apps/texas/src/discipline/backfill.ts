import prisma from '../models'
import { logger } from '../logger'
import { PLAYER_DISCIPLINE_VERSION } from './engine'
import { projectDisciplineForHand } from './projectFromHand'
import { scoreDisciplineForHand } from './scoreProjectedHand'

/**
 * 清空纪律分物化后，按 matchId 游标全量投影 + 评分。
 *
 * 依赖：
 * - BetRecord.source 已正确（盲注排除）
 * - PlayerStyleStat 已就绪（习惯分读 limp/VPIP 等；建议先 `backfill:style-stats`）
 */
export const rebuildDisciplineFromMatches = async (opts?: {
  batchSize?: number
  clearFirst?: boolean
}) => {
  const batchSize = opts?.batchSize ?? 50
  const clearFirst = opts?.clearFirst ?? true

  if (clearFirst) {
    await prisma.disciplineActionSnapshot.deleteMany({})
    await prisma.disciplineAppliedHand.deleteMany({})
    await prisma.playerDisciplineStat.deleteMany({})
    logger.info(
      '[discipline] cleared action_snapshot / applied_hand / player_discipline_stat'
    )
  }

  let cursor = 0
  let processed = 0
  let failed = 0
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
        await projectDisciplineForHand(row.id)
        await scoreDisciplineForHand(row.id)
        processed += 1
      } catch (err) {
        failed += 1
        logger.error(`[discipline] backfill matchId=${row.id} failed`, err)
      }
      cursor = row.id
    }
    logger.info(
      `[discipline] backfill progress cursor=${cursor} processed=${processed} failed=${failed} version=${PLAYER_DISCIPLINE_VERSION}`
    )
  }

  return { processed, failed, disciplineVersion: PLAYER_DISCIPLINE_VERSION }
}
