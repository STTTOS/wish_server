import cron from 'node-cron'

import { port } from './config'
import { createApp } from './app'
import { logger } from './logger'
import {
  freezeYesterdayDailyBar,
  syncDailyHistory
} from './services/dailySync'
import { runYesterdayDailyQuality } from './services/dailyQuality'
import { kickPricePoller, startPricePoller } from './services/poller'

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

  // 启动补写昨日质量（若尚无）
  void runYesterdayDailyQuality().catch((err) =>
    logger.warn('daily quality bootstrap failed', err)
  )

  // UTC 周五 22:00：周末收盘对齐（踢一脚进入短睡休市）
  cron.schedule(
    '0 22 * * 5',
    () => {
      kickPricePoller('cron: Fri 22:00 UTC weekend close')
    },
    { timezone: 'UTC' }
  )

  // UTC 周日 22:00：周末开盘对齐（双保险，避免短睡/定时器漂移漏采）
  cron.schedule(
    '0 22 * * 0',
    () => {
      kickPricePoller('cron: Sun 22:00 UTC weekend open')
    },
    { timezone: 'UTC' }
  )

  // 每个交易日 UTC 22:01 冻结上一 tick 日线 + 写日终质量快照
  cron.schedule(
    '1 22 * * *',
    () => {
      void (async () => {
        try {
          const froze = await freezeYesterdayDailyBar()
          if (froze)
            logger.info(
              'daily freeze cron',
              'previous trading day → tick:final'
            )
        } catch (err) {
          logger.error('daily freeze cron failed', err)
        }
        try {
          await runYesterdayDailyQuality()
        } catch (err) {
          logger.error('daily quality cron failed', err)
        }
      })()
    },
    { timezone: 'UTC' }
  )

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
