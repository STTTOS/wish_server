import fs from 'fs'
import { join } from 'path'
import { access } from 'fs/promises'

import { logger } from '../logger'

/**
 * @description 创建文件夹static, public, 以及系统文件system.json
 */
async function createDirectory() {
  return Promise.allSettled([
    access(join(__dirname, '../../public')).catch(() => {
      logger.info('创建public文件夹')
      fs.mkdirSync(join(__dirname, '../../public'))
    }),
    access(join(__dirname, './static')).catch(() => {
      logger.info('创建static文件夹')
      fs.mkdirSync(join(__dirname, '../../static/origin'), { recursive: true })
      fs.mkdirSync(join(__dirname, '../../static/files'), { recursive: true })
      fs.mkdirSync(join(__dirname, '../../static/temp'), { recursive: true })
    }),
    access(join(__dirname, '../system.json')).catch(() => {
      logger.info('写入system.json文件')
      fs.writeFileSync(
        join(__dirname, '../system.json'),
        '{ "viewCount": 0 }',
        {
          encoding: 'utf-8'
        }
      )
    })
  ])
}

export default createDirectory
