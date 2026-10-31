/* eslint-disable no-console */

/**
 * 全量重建牌风雷达物化表（清 PlayerStyleStat / StylePopulationStat 后按 ended match 重算）。
 *
 * 口径依赖 BetRecord.source：只计 action（贴盲 blind 已排除）。
 * 若刚回填了 source，须先：
 *   npm run backfill:bet-record-source -- --apply
 * 再跑本脚本（statsVersion 随 STYLE_STATS_VERSION bump）。
 *
 *   cd apps/texas
 *   npm run backfill:style-stats
 */
import { rebuildStyleStatsFromMatches } from '../src/styleStats/backfill'

const main = async () => {
  const result = await rebuildStyleStatsFromMatches({ clearFirst: true })
  console.log('styleStats backfill done', result)
  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
