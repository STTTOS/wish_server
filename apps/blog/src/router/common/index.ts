import fs from 'fs'
import sharp from 'sharp'
import dayjs from 'dayjs'
import cron from 'node-cron'
import { constants } from 'fs'
import koaBody from 'koa-body'
import Router from 'koa-router'
import { compose } from 'ramda'
import { join, basename } from 'path'
import { ParameterizedContext } from 'koa'
import { stat, access, readFile, writeFile } from 'fs/promises'

import { user } from '@/models'
import router from '../instance'
import { logger } from '../../logger'
import imageEncrypt from '@/utils/cryptor'
import response from '../../utils/response'
import { getAllFiles } from '../../utils/file'
import combinePath from '../../utils/combinePath'
import { apiPrefix, cosDomain } from '../../config'
import { decrypt, encrypt } from '@/utils/jwtCryptor'
import uploadFileToCos from '../../utils/uploadFileToCos'
import {
  processOneImage,
  assignOriginUploadPath,
  IMAGE_UPLOAD_BATCH_MAX,
  type UploadedImageFile,
  hashAndKeepOriginalName,
  processImagesBatchWithSizeFilter,
  IMAGE_UPLOAD_BATCH_PARSE_LIMIT_MB
} from '../../services/imageUpload'

const commonApi = combinePath(apiPrefix)('/common')

type Args = UploadedImageFile

const removeBlanks = (input: string) => input.replaceAll(/\s/g, '')
const mapFileNameToURI =
  (directory = '') =>
  (file: Args) =>
    join('/static', directory, removeBlanks(file.newFilename))

const collectUploadedImages = (files: Args | Args[] | undefined): Args[] => {
  if (!files) return []
  return Array.isArray(files) ? files : [files]
}

const getKoaBodyConfig = (
  directoryName: string,
  /**单位: mb */
  maxFileSize: number
): koaBody.IKoaBodyOptions => {
  return {
    // 支持文件格式
    multipart: true,
    formidable: {
      maxFileSize: maxFileSize * 1024 * 1024,
      // 保留文件扩展名
      keepExtensions: true,
      onFileBegin(_, file) {
        assignOriginUploadPath(directoryName)(file)
      }
    }
  }
}
const handleUpload =
  (directoryName: string) =>
  async (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ctx: ParameterizedContext<any, Router.IRouterParamContext<any, object>, any>
  ) => {
    const file = ctx.request.files?.file
    if (!file) throw new Error('空文件!')

    const files = Array.isArray(file) ? file : [file]
    const url = files.map(mapFileNameToURI(directoryName)).join(',')
    response.success(ctx, { url })
  }

// 上传文件到临时目录
router.post(
  commonApi('/upload_temp_file'),
  koaBody(getKoaBodyConfig('temp', 300)),
  handleUpload('temp')
)
// 上传文件到files目录
router.post(
  commonApi('/upload_persistent'),
  koaBody(getKoaBodyConfig('files', 200)),
  handleUpload('files')
),
  // 上传文件到protected目录, 即加密后的数据
  router.post(
    commonApi('/upload_image_encrypted'),
    koaBody({ multipart: true, formidable: { keepExtensions: true } }),
    async (ctx) => {
      const file = ctx.request.files?.file as Args

      const encryptedData = imageEncrypt.img.encrypt(file.filepath)
      const newFileName = compose(removeBlanks, hashAndKeepOriginalName)(file)

      fs.writeFileSync(
        join(__dirname, `../../../encryptedImageData/${newFileName}`),
        // TOOD: type error, resolve later
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        encryptedData
      )
      response.success(ctx, {
        url: join(
          '/images',
          `${newFileName}?token=${btoa(
            encrypt({ fileId: newFileName, userId: ctx.state.user!.id }, true)
          )}`
        )
      })
    }
  )

const parseFileIdFromToken = (token?: string) => {
  try {
    if (!token) return null
    const decoded = decrypt<{ fileId: string; userId: number }>(atob(token), {
      ignoreExpiration: true
    })
    return decoded
  } catch (error) {
    return null
  }
}
router.get('/images/:id', async (ctx) => {
  const fileName = ctx.params.id
  // 解析安全密码, 并且比较
  const secureKey = ctx.get('Securekey')
  // token
  const { token } = ctx.request.query as Record<string, string | undefined>
  const info = parseFileIdFromToken(token)

  const target = await user.findUnique({ where: { id: info?.userId } })

  if (
    !info ||
    !target ||
    !secureKey ||
    info.fileId !== fileName ||
    target?.secureKey !== secureKey
  ) {
    ctx.set('Content-Type', 'application/xml')
    ctx.body = `<?xml version='1.0' encoding='utf-8' ?>
<Error>
	<Code>AccessDenied</Code>
	<Message>You are denied by auth validation</Message>
	<Resource>/images/${fileName}</Resource>
</Error>
`
    return
  }
  const filePath = join(__dirname, `../../../encryptedImageData/${fileName}`)

  const decryptedData = imageEncrypt.img.decrypt(filePath)

  const stats = await stat(filePath)

  // 设置 Last-Modified 响应头
  ctx.set('Last-Modified', stats.mtime.toUTCString())
  // 缓存时间为 1 天 (单位为秒)
  // const maxAge = 86400
  // ctx.set('Cache-Control', `public, max-age=${maxAge}`)
  ctx.set('Content-Type', 'image/jpeg')
  // 直接返回二进制数据
  ctx.body = decryptedData
  ctx.status = 200
})

// 上传任意文件到cos
router.post(
  commonApi('/upload_file'),
  koaBody(getKoaBodyConfig('temp', 200)),
  async (ctx) => {
    const file = ctx.request.files?.file as Args

    if (!file) throw new Error('空文件!')

    const startTime = dayjs()
    const url = await uploadFileToCos('files', file.newFilename, file.filepath)
    const endTime = dayjs()
    logger.info(
      `上传${file.originalFilename}(${file.size});耗时: ${endTime.diff(
        startTime,
        'second'
      )}s`
    )

    response.success(ctx, {
      url: `https://${cosDomain}/files/${basename(url)}`
    })
  }
)

// 上传图片（单张）
router.post(
  commonApi('/upload_image'),
  koaBody(getKoaBodyConfig('origin', 30)),
  async (ctx) => {
    const [file] = collectUploadedImages(
      ctx.request.files?.file as Args | Args[] | undefined
    )
    if (!file) throw new Error('空文件!')

    const data = await processOneImage(file)
    response.success(ctx, data)
  }
)

// 批量上传图片（Gallery 分块调用，每批最多 4 张）
router.post(
  commonApi('/upload_images'),
  koaBody(getKoaBodyConfig('origin', IMAGE_UPLOAD_BATCH_PARSE_LIMIT_MB)),
  async (ctx) => {
    const files = collectUploadedImages(
      ctx.request.files?.file as Args | Args[] | undefined
    )
    if (files.length === 0) throw new Error('空文件!')
    if (files.length > IMAGE_UPLOAD_BATCH_MAX) {
      throw new Error(`单次最多上传 ${IMAGE_UPLOAD_BATCH_MAX} 张图片`)
    }

    const { items, failures } = await processImagesBatchWithSizeFilter(files)
    if (items.length === 0) {
      const detail = failures.map((f) => f.filename || '未知文件').join(', ')
      throw new Error(`图片上传失败: ${detail}`)
    }

    response.success(ctx, { items, failures })
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
    await uploadFileToCos('base/blog', filename, file)
  }
  logger.info('成功上传静态资源到cdn, 发布应用: blog')
  response.success(ctx, null, '部署成功')
})

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

// 图片压缩
router.post(
  commonApi('/compressImage'),
  koaBody(getKoaBodyConfig('temp', 50)),
  async (ctx) => {
    const { ratio = 30 } = ctx.request.body
    const file = ctx.request.files?.file as unknown as Args
    if (!file) throw new Error('空文件!')

    const compressFilePath = join(
      __dirname,
      '../../../static/temp',
      `compressed_${file.newFilename}`
    )

    // 压缩图片
    const compressedInfo = await sharp(file.filepath)
      .rotate()
      .jpeg({ quality: Number(ratio), mozjpeg: true })
      .toFile(compressFilePath)

    response.success(ctx, {
      url: `/static/temp/compressed_${file.newFilename}`,
      originSize: file.size,
      filename: file.originalFilename,
      compressedSize: compressedInfo.size
    })
  }
)
