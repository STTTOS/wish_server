import { unlink } from 'fs/promises'

import router from '../instance'
import { logger } from '../../logger'
import { apiPrefix } from '../../config'
import { ok, fail } from '../../utils/apiResult'
import combinePath from '../../utils/combinePath'
import { HTTP_STATUS } from '../../constants/httpStatus'
import { uploadImageViaBlog } from '../../services/blogImageUpload'
import { respondFromApiResult } from '../../utils/respondFromApiResult'

const commonApi = combinePath(apiPrefix)('/common')

type FormidableFile = {
  filepath: string
  originalFilename?: string | null
  mimetype?: string | null
  size?: number
}

function pickSingleFile(files: unknown): FormidableFile | null {
  if (!files || typeof files !== 'object') return null
  const raw = (files as { file?: FormidableFile | FormidableFile[] }).file
  if (!raw) return null
  return Array.isArray(raw) ? raw[0] ?? null : raw
}

router.post(commonApi('/upload_image'), async (ctx) => {
  const file = pickSingleFile(ctx.request.files)
  if (!file?.filepath) {
    respondFromApiResult(
      ctx,
      fail(HTTP_STATUS.BAD_REQUEST, '请选择要上传的图片')
    )
    return
  }

  try {
    const data = await uploadImageViaBlog(file)
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
  } finally {
    await unlink(file.filepath).catch(() => undefined)
  }
})
