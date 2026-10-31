/* eslint-disable no-console */

/**
 * 全量重建牌风雷达物化表。
 *
 *   cd apps/texas
 *   npx ts-node --transpile-only scripts/backfillStyleStats.ts
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
