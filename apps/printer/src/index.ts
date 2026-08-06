import { createServer } from 'http'
import { join } from 'path'
import { mkdir } from 'fs/promises'

import { port } from './config'
import { createApp } from './app'
import { logger } from './logger'
import { attachDeskSocket } from './services/deskSocket'
import { startPrintFileCleanupCron } from './services/cleanupJob'

const staticDir = join(__dirname, '../static')

async function bootstrap() {
  if (!process.env.SECRET_KEY) {
    throw new Error('SECRET_KEY is required')
  }
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required')
  }

  // koa-static 挂载 /static；上传已不落盘，目录仅保障静态服务
  await mkdir(staticDir, { recursive: true })

  const app = createApp()
  const server = createServer(app.callback())
  attachDeskSocket(server)
  startPrintFileCleanupCron()

  server.listen(Number(port), () => {
    logger.info('printer server startup', `http://localhost:${port}`)
    logger.info('H5 upload', `http://localhost:${port}/?shop=default`)
  })
}

bootstrap().catch((error) => {
  logger.error(error)
  process.exit(1)
})
