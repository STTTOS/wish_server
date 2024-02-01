import { join } from 'path'
import { constants } from 'fs'
import { access, readFile, writeFile } from 'fs/promises'

import router from '../instance'
import { apiPrefix } from '../../config'
import response from '../../utils/response'
import combinePath from '../../utils/combinePath'

const commonApi = combinePath(apiPrefix)('/common')

// 接收二进制流
router.post(commonApi('/upload'), async (ctx) => {
  const file = ctx.request.files?.file

  if (!file) throw new Error('空文件!')

  const files = Array.isArray(file) ? file : [file]
  const url = files.map(({ newFilename }) => `/static/${newFilename}`).join(',')

  response.success(ctx, { url })
})

async function countView(filePath: string, increment = 0) {
  if (increment === 0) return

  try {
    // 文件是否存在
    await access(filePath, constants.F_OK)

    const buffer = await readFile(filePath)
    const { viewCount } = JSON.parse(buffer.toString())

    const newData = { viewCount: viewCount + increment }
    await writeFile(filePath, JSON.stringify(newData))
  } catch (error) {
    const initialData = { viewCount: 0 }
    await writeFile(filePath, JSON.stringify(initialData))
  }
}

let tmpCount = 0
setInterval(() => {
  const filePath = join(__dirname, '../../../system.json')
  countView(filePath, tmpCount)
  tmpCount = 0
}, 1000 * 60 * 60)

// 网站访问量埋点
router.post(commonApi('/webViewCount'), async (ctx) => {
  tmpCount++
  response.success(ctx, null)
})

// 获取网站访问量
router.post(commonApi('/getWebViewCount'), async (ctx) => {
  const filePath = join(__dirname, '../../../system.json')

  try {
    await access(filePath)

    const buffer = await readFile(filePath)
    const { viewCount } = JSON.parse(buffer.toString())
    response.success(ctx, { viewCount })
  } catch (error) {
    response.success(ctx, { viewCount: 0 })
  }
})
