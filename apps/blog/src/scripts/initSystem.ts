import fs from 'fs'
import { join } from 'path'
import { access } from 'fs/promises'

import { logger } from '../logger'

async function createFiles() {
  await access(join(__dirname, './static')).catch(() => {
    fs.mkdirSync(join(__dirname, '../../static/origin'), { recursive: true })
    fs.mkdirSync(join(__dirname, '../../static/files'), { recursive: true })
    fs.mkdirSync(join(__dirname, '../../static/temp'), { recursive: true })
  })
  await access(join(__dirname, '../system.json')).catch(() => {
    fs.writeFileSync(join(__dirname, '../system.json'), '{ "viewCount": 0 }', {
      encoding: 'utf-8'
    })
  })
}

logger.info('初始化系统中...')
createFiles().then(() => {
  logger.info('初始化系统完成')
})
