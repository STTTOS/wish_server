import type { UploadedImageFile } from '@wishufree/cos-upload'

import koaBody from 'koa-body'

import router from '../instance'
import { logger } from '../../logger'
import { apiPrefix } from '../../config'
import { ok, fail } from '../../utils/apiResult'
import combinePath from '../../utils/combinePath'
import { HTTP_STATUS } from '../../constants/httpStatus'
import { getCosUploadClient } from '../../services/cosUpload'
import { respondFromApiResult } from '../../utils/respondFromApiResult'

const commonApi = combinePath(apiPrefix)('/common')

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
