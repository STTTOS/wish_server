import { port } from './config'
import { createApp } from './app'
import { logger } from './logger'
import { ensureDefaultCategory } from './services/ensureDefaultCategory'

async function bootstrap() {
  if (!process.env.SECRET_KEY) {
    throw new Error('SECRET_KEY is required')
  }
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required')
  }

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
