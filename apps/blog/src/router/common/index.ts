import fs from 'fs'
import { v4 } from 'uuid'
import sharp from 'sharp'
import cron from 'node-cron'
import { constants } from 'fs'
import koaBody from 'koa-body'
import Router from 'koa-router'
import { compose } from 'ramda'
import { ParameterizedContext } from 'koa'
import { join, extname, basename } from 'path'
import { access, readFile, writeFile } from 'fs/promises'

import { user } from '@/models'
import router from '../instance'
import { logger } from '../../logger'
import imageEncrypt from '@/utils/cryptor'
import response from '../../utils/response'
import combinePath from '../../utils/combinePath'
import { decrypt, encrypt } from '@/utils/jwtCryptor'
import uploadFileToCos from '../../utils/uploadFileToCos'
import { getAllFiles, getFileName } from '../../utils/file'
import { apiPrefix, fileNameSpliter, imageCompressRatio } from '../../config'

const commonApi = combinePath(apiPrefix)('/common')

interface Args {
  newFilename: string
  originalFilename: string | null
  filepath: string
}

const removeBlanks = (input: string) => input.replaceAll(/\s/g, '')
const mapFileNameToURI =
  (directory = '') =>
  (file: Args) =>
    join('/static', directory, removeBlanks(file.newFilename))

export const hashAndKeepOriginalName = ({ originalFilename }: Args) =>
  `${getFileName(
    originalFilename || 'file_unknown'
  )}${fileNameSpliter}${v4()}${extname(originalFilename || '')}`

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
        const newFileName = compose(removeBlanks, hashAndKeepOriginalName)(file)

        file.filepath = join(
          __dirname,
          join('../../../static/', directoryName, newFileName)
        )
        file.newFilename = newFileName
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
  koaBody(getKoaBodyConfig('temp', 3000)),
  handleUpload('temp')
)
// 上传文件到files目录
router.post(
  commonApi('/upload_persistent'),
  koaBody(getKoaBodyConfig('files', 2000)),
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
        encryptedData
      )
      response.success(ctx, {
        url: join(
          '/images',
          `${newFileName}?token=${btoa(
            encrypt({ fileId: newFileName, userId: ctx.state.user!.id })
          )}`
        )
      })
    }
  )

const parseFileIdFromToken = (token?: string) => {
  try {
    if (!token) return null
    const decoded = decrypt<{ fileId: string; userId: number }>(atob(token))
    return decoded
  } catch (error) {
    return null
  }
}
router.get('/images/:id', async (ctx) => {
  const fileName = ctx.params.id
  // 解析安全密码, 并且比较
  const { secureKey } = ctx.header
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

  ctx.set('Content-Type', 'image/jpeg')
  // 直接返回二进制数据
  ctx.body = decryptedData
  ctx.status = 200
})

// 上传任意文件到cos
router.post(
  commonApi('/upload_file'),
  koaBody(getKoaBodyConfig('temp', 2000)),
  async (ctx) => {
    const file = ctx.request.files?.file as Args

    if (!file) throw new Error('空文件!')

    const url = await uploadFileToCos('videos', file.newFilename, file.filepath)
    response.success(ctx, { url: `https://${url}` })
  }
)

// 上传图片
// 直接使用cos存储
router.post(
  commonApi('/upload_image'),
  koaBody(getKoaBodyConfig('origin', 10)),
  async (ctx) => {
    const file = ctx.request.files?.file as unknown as Args
    if (!file) throw new Error('空文件!')

    await uploadFileToCos('images/origin', file.newFilename, file.filepath)

    const compressFilePath = join(
      __dirname,
      '../../../static/',
      file.newFilename
    )

    const originWith = (await sharp(file.filepath).metadata()).width
    // 压缩图片
    await sharp(file.filepath)
      .rotate()
      .resize(originWith && Math.floor(originWith * imageCompressRatio))
      .jpeg({ quality: 80 })
      .toFile(compressFilePath)
    const url = await uploadFileToCos(
      'images/compressed',
      file.newFilename,
      compressFilePath
    )
    response.success(ctx, { url: `https://${url}` })
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
