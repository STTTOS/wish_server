import { logger } from '../logger'
import { ensureRoadSeed } from './seedRoads'

ensureRoadSeed()
  .then((result) => {
    logger.info('db:seed done', result)
    process.exit(0)
  })
  .catch((error) => {
    logger.error(error)
    process.exit(1)
  })
