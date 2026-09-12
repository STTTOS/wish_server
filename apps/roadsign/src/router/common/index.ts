import type { UploadedImageFile } from '@wishufree/cos-upload'

import koaBody from 'koa-body'

import router from '../instance'
import { logger } from '../../logger'
import { ok, fail } from '../../utils/apiResult'
import combinePath from '../../utils/combinePath'
import { apiPrefix, amapWebKey } from '../../config'
import { HTTP_STATUS } from '../../constants/httpStatus'
import { getCosUploadClient } from '../../services/cosUpload'
import { respondFromApiResult } from '../../utils/respondFromApiResult'

const commonApi = combinePath(apiPrefix)('/common')

function asSingle(value: unknown): string {
  if (Array.isArray(value)) return String(value[0] ?? '')
  return value === undefined || value === null ? '' : String(value)
}

/**
 * 代理高德静态地图，避免浏览器 CORS，并隐藏 Web 服务 Key。
 * 查询参数透传（location/zoom/size/markers/paths/maptype…），服务端追加 key。
 */
router.get(commonApi('/static_map'), async (ctx) => {
  if (!amapWebKey) {
    ctx.status = HTTP_STATUS.BAD_REQUEST
    ctx.body = { ok: false, message: '未配置 AMAP_WEB_KEY，无法生成卫星底图' }
    return
  }

  const allowed = [
    'location',
    'zoom',
    'size',
    'scale',
    'maptype',
    'markers',
    'paths',
    'labels',
    'traffic'
  ] as const

  const qs = new URLSearchParams()
  for (const key of allowed) {
    const raw = asSingle(ctx.query[key]).trim()
    if (raw) qs.set(key, raw)
  }
  if (!qs.has('size')) qs.set('size', '720*420')
  if (!qs.has('scale')) qs.set('scale', '2')
  if (!qs.has('maptype')) qs.set('maptype', 'satellite')
  qs.set('key', amapWebKey)

  const url = `https://restapi.amap.com/v3/staticmap?${qs.toString()}`
  try {
    const res = await fetch(url)
    const buf = Buffer.from(await res.arrayBuffer())
    const ctype = res.headers.get('content-type') || ''

    // 高德失败时常返回 JSON（以 `{` 开头）
    if (!res.ok || ctype.includes('json') || buf[0] === 0x7b) {
      let message = '静态地图请求失败'
      try {
        const json = JSON.parse(buf.toString('utf8')) as {
          info?: string
          infocode?: string
        }
        message = json.info || message
      } catch {
        // ignore
      }
      ctx.status = HTTP_STATUS.BAD_REQUEST
      ctx.body = { ok: false, message }
      return
    }

    ctx.set('Cache-Control', 'private, max-age=300')
    ctx.type = ctype.includes('image') ? ctype : 'image/png'
    ctx.body = buf
  } catch (error) {
    logger.error(error)
    ctx.status = HTTP_STATUS.BAD_REQUEST
    ctx.body = {
      ok: false,
      message: error instanceof Error ? error.message : '静态地图代理失败'
    }
  }
})

function collectUploadedImages(
  files: UploadedImageFile | UploadedImageFile[] | undefined
): UploadedImageFile[] {
  if (!files) return []
  return Array.isArray(files) ? files : [files]
}

function getUploadBodyConfig(maxFileSizeMb: number): koaBody.IKoaBodyOptions {
  const cos = getCosUploadClient()
  return {
    multipart: true,
    formidable: {
      maxFileSize: maxFileSizeMb * 1024 * 1024,
      keepExtensions: true,
      onFileBegin(_, file) {
        cos.assignOriginUploadPath('origin')(file)
      }
    }
  }
}

router.post(
  commonApi('/upload_image'),
  (ctx, next) => koaBody(getUploadBodyConfig(30))(ctx, next),
  async (ctx) => {
    const [file] = collectUploadedImages(
      ctx.request.files?.file as
        | UploadedImageFile
        | UploadedImageFile[]
        | undefined
    )
    if (!file) {
      respondFromApiResult(
        ctx,
        fail(HTTP_STATUS.BAD_REQUEST, '请选择要上传的图片')
      )
      return
    }

    try {
      const data = await getCosUploadClient().processOneImage(file)
      respondFromApiResult(ctx, ok(data), { okMessage: '上传成功' })
    } catch (error) {
      logger.error(error)
      respondFromApiResult(
        ctx,
        fail(
          HTTP_STATUS.BAD_REQUEST,
          error instanceof Error ? error.message : '上传失败'
        )
      )
    }
  }
)

router.post(
  commonApi('/upload_images'),
  (ctx, next) =>
    koaBody(
      getUploadBodyConfig(
        getCosUploadClient().constants.IMAGE_UPLOAD_BATCH_PARSE_LIMIT_MB
      )
    )(ctx, next),
  async (ctx) => {
    const files = collectUploadedImages(
      ctx.request.files?.file as
        | UploadedImageFile
        | UploadedImageFile[]
        | undefined
    )
    const cos = getCosUploadClient()
    if (files.length === 0) {
      respondFromApiResult(
        ctx,
        fail(HTTP_STATUS.BAD_REQUEST, '请选择要上传的图片')
      )
      return
    }
    if (files.length > cos.constants.IMAGE_UPLOAD_BATCH_MAX) {
      respondFromApiResult(
        ctx,
        fail(
          HTTP_STATUS.BAD_REQUEST,
          `单次最多上传 ${cos.constants.IMAGE_UPLOAD_BATCH_MAX} 张图片`
        )
      )
      return
    }

    try {
      const data = await cos.processImagesBatchWithSizeFilter(files)
      if (data.items.length === 0) {
        respondFromApiResult(
          ctx,
          fail(HTTP_STATUS.BAD_REQUEST, data.failures[0]?.message || '上传失败')
        )
        return
      }
      respondFromApiResult(ctx, ok(data), { okMessage: '上传成功' })
    } catch (error) {
      logger.error(error)
      respondFromApiResult(
        ctx,
        fail(
          HTTP_STATUS.BAD_REQUEST,
          error instanceof Error ? error.message : '上传失败'
        )
      )
    }
  }
)
