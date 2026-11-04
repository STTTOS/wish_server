/* eslint-disable no-console */

/**
 * 从 PlayerMatchRecord 全量重建玩家荣誉物化表。
 *
 *   cd apps/texas
 *   npm run backfill:player-honors
 */
import { rebuildPlayerHonorsFromRecords } from '../src/styleStats/playerHonors'

const main = async () => {
  const result = await rebuildPlayerHonorsFromRecords({ clearFirst: true })
  console.log('playerHonors backfill done', result)
  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
