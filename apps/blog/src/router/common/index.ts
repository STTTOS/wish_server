import sharp from 'sharp'
import cron from 'node-cron'
import { constants } from 'fs'
import koaBody from 'koa-body'
import { join, basename } from 'path'
import { access, readFile, writeFile } from 'fs/promises'

import router from '../instance'
import { logger } from '../../logger'
import response from '../../utils/response'
import combinePath from '../../utils/combinePath'
import uploadFileToCos from '../../utils/uploadFileToCos'
import { getAllFiles, getFileName } from '../../utils/file'
import { apiPrefix, fileNameSpliter, imageCompressRatio } from '../../config'

const commonApi = combinePath(apiPrefix)('/common')

interface Args {
  newFilename: string
  originalFilename: string | null
}

export const hashAndKeepOriginalName = ({
  newFilename,
  originalFilename
}: Args) =>
  `${getFileName(
    originalFilename || 'file_unknown'
  )}${fileNameSpliter}${newFilename}`

router.post(
  commonApi('/upload_temp_file'),
  koaBody({
    // 支持文件格式
    multipart: true,
    formidable: {
      // 保留文件扩展名
      maxFileSize: 1024 * 1024 * 600,
      keepExtensions: true,
      // 上传目录
      uploadDir: join(__dirname, '../../../static/temp'),
      onFileBegin(_, file) {
        const newFileName = hashAndKeepOriginalName(file)
        file.filepath = join(__dirname, `../../../static/temp/${newFileName}`)
        file.newFilename = newFileName
      }
    }
  }),
  async (ctx) => {
    const file = ctx.request.files?.file

    if (!file) throw new Error('空文件!')

    const files = Array.isArray(file) ? file : [file]

    const url = files
      .map(({ newFilename }) => `/static/temp/${newFilename}`)
      .join(',')

    response.success(ctx, { url })
  }
)

router.post(
  commonApi('/upload_file'),
  koaBody({
    // 支持文件格式
    multipart: true,
    formidable: {
      maxFileSize: 1024 * 1024 * 600,
      // 保留文件扩展名
      keepExtensions: true,
      // 上传目录
      uploadDir: join(__dirname, '../../../static/files'),
      onFileBegin(_, file) {
        const newFileName = hashAndKeepOriginalName(file)
        file.filepath = join(__dirname, `../../../static/files/${newFileName}`)
        file.newFilename = newFileName
      }
    }
  }),
  async (ctx) => {
    const file = ctx.request.files?.file

    if (!file) throw new Error('空文件!')

    const files = Array.isArray(file) ? file : [file]

    const url = files
      .map(({ newFilename }) => `/static/files/${newFilename}`)
      .join(',')

    response.success(ctx, { url })
  }
)

router.post(commonApi('/deploy_blog_frontend'), async (ctx) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  // const file = ctx.request.files?.file as unknown as any
  logger.info('上传静态资源到cdn...')
  // 读取编译后文件夹目录
  const assets = await getAllFiles(join(__dirname, '../../../public'), {
    exclude: ['index.html']
  })
  for (const file of assets) {
    const filename = basename(file)
    await uploadFileToCos('blog', filename, file)
  }
  logger.info('成功上传静态资源到cdn, 发布应用: blog')
  response.success(ctx, null, '部署成功')
})

// 接收二进制流
router.post(
  commonApi('/upload'),
  koaBody({
    // 支持文件格式
    multipart: true,
    formidable: {
      maxFileSize: 1024 * 1024 * 10,
      // 保留文件扩展名
      keepExtensions: true,
      // 上传目录
      uploadDir: join(__dirname, '../../../static/origin')
    }
  }),
  async (ctx) => {
    const file = ctx.request.files?.file

    if (!file) throw new Error('空文件!')

    const files = Array.isArray(file) ? file : [file]

    // 压缩文件
    for (const item of files) {
      await sharp(item.filepath)
        .jpeg({ quality: imageCompressRatio * 100 })
        .toFile(
          join(
            __dirname,
            `../../../static/origin/${hashAndKeepOriginalName(item)}`
          )
        )
    }

    const url = files
      .map((item) => `/static/origin/${hashAndKeepOriginalName(item)}`)
      .join(',')

    response.success(ctx, { url })
  }
)

async function countView(filePath: string, increment = 0) {
  if (increment === 0) return

  try {
    // 文件是否存在
    await access(filePath, constants.F_OK)

    const input = await readFile(filePath, { encoding: 'utf-8' })
    const { viewCount } = JSON.parse(input)

    const newData = { viewCount: viewCount + increment }
    await writeFile(filePath, JSON.stringify(newData))
  } catch (error) {
    const initialData = { viewCount: 0 }
    await writeFile(filePath, JSON.stringify(initialData))
  }
}

let tmpCount = 0
cron.schedule('*/5 * * * * *', async () => {
  const filePath = join(__dirname, '../../../system.json')
  await countView(filePath, tmpCount)
  tmpCount = 0
})
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
