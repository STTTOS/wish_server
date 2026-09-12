import { join } from 'path'
import { mkdir } from 'fs/promises'

import { port } from './config'
import { createApp } from './app'
import { logger } from './logger'

const staticOriginDir = join(__dirname, '../static/origin')
const publicDir = join(__dirname, '../public')

async function bootstrap() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required')
  }

  await mkdir(staticOriginDir, { recursive: true })
  await mkdir(publicDir, { recursive: true })

  const app = createApp()
  app.listen(Number(port), () => {
    logger.info('roadsign server startup', `http://localhost:${port}`)
    logger.info('health', `http://localhost:${port}/api/health`)
  })
}

bootstrap().catch((error) => {
  logger.error(error)
  process.exit(1)
})
