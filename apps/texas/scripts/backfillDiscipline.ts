/* eslint-disable no-console */

/**
 * 全量重建纪律分（清 DisciplineActionSnapshot / AppliedHand / PlayerDisciplineStat 后按 ended match 重算）。
 *
 * 用法（在 apps/texas）：
 *   npm run backfill:discipline
 *   npm run backfill:discipline -- --no-clear   # 不清表，只补未 Applied 的手
 */
import { rebuildDisciplineFromMatches } from '../src/discipline/backfill'

const noClear = process.argv.includes('--no-clear')

async function main() {
  const result = await rebuildDisciplineFromMatches({ clearFirst: !noClear })
  console.log('discipline backfill done', result)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
