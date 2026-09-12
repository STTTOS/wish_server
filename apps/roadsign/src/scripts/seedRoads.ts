import prisma from '../models'
import { logger } from '../logger'
import { CHAMDO_ROAD_SEED } from './roadSeedData'

/** 道路表为空时写入种子；已有数据不覆盖 */
export async function ensureRoadSeed() {
  const count = await prisma.road.count()
  if (count > 0) {
    logger.info('road seed skipped', `existing=${count}`)
    return { inserted: 0, skipped: true as const }
  }

  const rows = CHAMDO_ROAD_SEED.map((name, index) => ({
    name,
    sort: (index + 1) * 10
  }))

  const result = await prisma.road.createMany({
    data: rows,
    skipDuplicates: true
  })

  logger.info('road seed inserted', result.count)
  return { inserted: result.count, skipped: false as const }
}
