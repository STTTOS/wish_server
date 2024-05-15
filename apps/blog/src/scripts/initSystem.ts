import { logger } from '../logger'
import createDirectory from './createDirectory'

// import generateDelcaration from './generateDelcaration'

async function initSystem() {
  logger.info('初始化系统中...')
  await Promise.allSettled([createDirectory()])
  logger.info('初始化系统完成')
}

initSystem()
