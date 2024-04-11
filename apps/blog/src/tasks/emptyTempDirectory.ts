import { join } from 'path'
import cron from 'node-cron'
import { rm } from 'fs/promises'

import { logger } from '../logger'
import { getAllFiles } from '../utils/file'

logger.info('启动临时文件定时删除服务')
// 每天00:00执行删除任务
cron.schedule('00 00 * * *', async () => {
  const files = await getAllFiles(join(__dirname, '../../static/temp'))
  for (const filePath of files) {
    await rm(filePath)
  }
  logger.info(`成功删除临时文件目录, 文件数:${files.length}`)
})
