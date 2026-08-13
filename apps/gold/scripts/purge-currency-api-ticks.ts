/**
 * 一次性：删除 Tick 表中 currency-api* 日级近似脏点。
 * 用法（在 apps/gold）：npx tsx --env-file=.env scripts/purge-currency-api-ticks.ts
 */
import { logger } from '../src/logger'
import prisma from '../src/models'

async function main() {
  const where = {
    OR: [
      { source: 'currency-api' },
      { source: { startsWith: 'currency-api' } }
    ]
  }
  const before = await prisma.tick.count({ where })
  logger.info(`before ${before}`)
  const del = await prisma.tick.deleteMany({ where })
  logger.info(`deleted ${del.count}`)
  const after = await prisma.tick.count({ where })
  logger.info(`after ${after}`)
}

main()
  .catch((e) => {
    logger.error(e)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
