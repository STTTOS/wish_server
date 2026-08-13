import cron from 'node-cron'

import { port } from './config'
import { createApp } from './app'
import { logger } from './logger'
import {
  freezeYesterdayDailyBar,
  syncDailyHistory
} from './services/dailySync'
import { startPricePoller } from './services/poller'

async function bootstrap() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required')
  }

  const app = createApp()

  app.listen(Number(port), () => {
    logger.info('gold server startup', `http://localhost:${port}`)
    logger.info('health', `http://localhost:${port}/api/health`)
  })

  startPricePoller()

  // 启动后异步拉日线，不挡 listen（sync 内会先冻结昨日 tick）
  void syncDailyHistory()
    .then((r) => logger.info('daily sync', r.message))
    .catch((err) => logger.error('daily sync failed', err))

  // 每天 00:01 冻结昨日 tick 日线（防 currency-api / 迟到写覆盖）
  cron.schedule('1 0 * * *', () => {
    void freezeYesterdayDailyBar()
      .then((froze) => {
        if (froze) logger.info('daily freeze cron', 'yesterday → tick:final')
      })
      .catch((err) => logger.error('daily freeze cron failed', err))
  })

  // 每天 06:30 / 18:30（服务器本地时区）增量补日线
  cron.schedule('30 6,18 * * *', () => {
    void syncDailyHistory()
      .then((r) => logger.info('daily cron', r.message))
      .catch((err) => logger.error('daily cron failed', err))
  })
}

bootstrap().catch((error) => {
  logger.error(error)
  process.exit(1)
})
