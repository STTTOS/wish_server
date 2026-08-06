import router from '../instance'
import { logger } from '../../logger'
import { apiPrefix } from '../../config'
import { ok, fail } from '../../utils/apiResult'
import combinePath from '../../utils/combinePath'
import { HTTP_STATUS } from '../../constants/httpStatus'
import { getCosUploadClient } from '../../services/cosUpload'
import { takeMemoryUploadBuffer } from '../../utils/memoryUpload'
import { respondFromApiResult } from '../../utils/respondFromApiResult'

const commonApi = combinePath(apiPrefix)('/common')

type MemoryUploadFile = {
  filepath?: string
  originalFilename?: string | null
  mimetype?: string | null
  size?: number
  newFilename?: string
  buffer?: Buffer
}

function pickSingleFile(files: unknown): MemoryUploadFile | null {
  if (!files || typeof files !== 'object') return null
  const raw = (files as { file?: MemoryUploadFile | MemoryUploadFile[] }).file
  if (!raw) return null
  return Array.isArray(raw) ? raw[0] ?? null : raw
}

/** 登录即可上传；不走管理员限制。内存 → sharp → 仅 compressed COS */
router.post(commonApi('/upload_image'), async (ctx) => {
  const file = pickSingleFile(ctx.request.files)
  const buffer = takeMemoryUploadBuffer(file)
  if (!buffer?.length) {
    respondFromApiResult(
      ctx,
      fail(HTTP_STATUS.BAD_REQUEST, '请选择要上传的图片')
    )
    return
  }

  const cos = getCosUploadClient()
  const newFilename = cos
    .hashAndKeepOriginalName({
      originalFilename: file?.originalFilename ?? null
    })
    .replaceAll(/\s/g, '')

  try {
    const data = await cos.processCompressedImageFromBuffer({
      buffer,
      originalFilename: file?.originalFilename ?? null,
      newFilename,
      size: file?.size ?? buffer.length
    })
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
})
