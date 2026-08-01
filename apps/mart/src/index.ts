import { join } from 'path'
import { mkdir } from 'fs/promises'

import { port } from './config'
import { createApp } from './app'
import { logger } from './logger'
import { ensureDefaultCategory } from './services/ensureDefaultCategory'

/** formidable / 本地临时图写入目录；部署机若未预建会 ENOENT */
const staticDir = join(__dirname, '../static')

async function bootstrap() {
  if (!process.env.SECRET_KEY) {
    throw new Error('SECRET_KEY is required')
  }
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required')
  }

  await mkdir(staticDir, { recursive: true })
  await ensureDefaultCategory()

  const app = createApp()
  app.listen(port, () => {
    logger.info('mart server startup', `http://localhost:${port}`)
  })
}

bootstrap().catch((error) => {
  logger.error(error)
  process.exit(1)
})
