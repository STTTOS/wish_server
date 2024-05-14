import dayjs from 'dayjs'
import cron from 'node-cron'

import { logger } from '../logger'
import { article } from '@/models'

logger.info('启动回收站30天自动删除任务')
// 每天00:00执行删除任务
cron.schedule('00 00 * * *', async () => {
  const thirtyDaysAgo = dayjs().subtract(30, 'day')

  const result = await article.deleteMany({
    where: { deletedAt: { lt: thirtyDaysAgo.toDate() } }
  })
  logger.info(`自动删除回收站文件: ${result.count}个`)
})
