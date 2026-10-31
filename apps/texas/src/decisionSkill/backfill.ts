import prisma from '../models'
import { logger } from '../logger'
import { PLAYER_TECH_VERSION } from './engine'
import { projectDecisionSkillForHand } from './projectFromHand'
import { scoreDecisionSkillForHand } from './scoreProjectedHand'

/**
 * 清空决策技术分物化后，按 matchId 游标全量投影 + 评分。
 *
 * 依赖：
 * - BetRecord.source 已正确（盲注排除）
 * - PlayerStyleStat 已就绪（结构分读 limp/VPIP 等；建议先 `backfill:style-stats`）
 *
 * 结构分按「当前」牌风轴计算；全量重建时若 style 已最终态，则每手使用同一套结构信号，
 * 最终 PlayerTech.structureScore 与线上增量终态一致。
 */
export const rebuildDecisionSkillFromMatches = async (opts?: {
  batchSize?: number
  clearFirst?: boolean
}) => {
  const batchSize = opts?.batchSize ?? 50
  const clearFirst = opts?.clearFirst ?? true

  if (clearFirst) {
    await prisma.decisionSkillSnapshot.deleteMany({})
    await prisma.decisionSkillAppliedHand.deleteMany({})
    await prisma.playerTechStat.deleteMany({})
    logger.info(
      '[decisionSkill] cleared snapshot / applied_hand / player_tech_stat'
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
        await projectDecisionSkillForHand(row.id)
        await scoreDecisionSkillForHand(row.id)
        processed += 1
      } catch (err) {
        failed += 1
        logger.error(`[decisionSkill] backfill matchId=${row.id} failed`, err)
      }
      cursor = row.id
    }
    logger.info(
      `[decisionSkill] backfill progress cursor=${cursor} processed=${processed} failed=${failed} version=${PLAYER_TECH_VERSION}`
    )
  }

  return { processed, failed, techVersion: PLAYER_TECH_VERSION }
}
