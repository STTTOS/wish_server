import { join, basename } from 'path'

import { logger } from '../logger'
import { getAllFiles } from '../utils/file'
import uploadFileToCos from '../utils/uploadFileToCos'

// 将静态资源文件上传到cdn
async function deploy() {
  logger.info('上传静态资源到cdn...')
  const assets = await getAllFiles(join(__dirname, '../../public'), {
    exclude: ['index.html']
  })
  for (const file of assets) {
    const filename = basename(file)
    await uploadFileToCos('blog', filename, file)
  }
  logger.info('静态资源上传成功, 部署完毕')
}

deploy()
