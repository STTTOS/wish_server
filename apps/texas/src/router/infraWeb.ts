import router from './instance'
import response from '../utils/response'
import { apiPrefixWeb } from '../config'
import { assertWebAdmin } from './webAuth'
import combinePath from '../utils/combinePath'
import { HTTP_STATUS } from '../constants/httpStatus'
import {
  runNginxTest,
  uploadSslFiles,
  runNginxReload,
  SslCertOpsError,
  type UploadedSslFile
} from '../services/sslCertOps'

const systemApiWeb = combinePath(apiPrefixWeb)('/system')

type KoaUploadedFile = {
  filepath: string
  originalFilename: string | null
  size: number
}

const collectUploadedFiles = (
  files:
    | Record<string, KoaUploadedFile | KoaUploadedFile[] | undefined>
    | null
    | undefined
): UploadedSslFile[] => {
  if (!files) return []
  const result: UploadedSslFile[] = []
  for (const value of Object.values(files)) {
    if (!value) continue
    const list = Array.isArray(value) ? value : [value]
    for (const file of list) {
      result.push({
        filepath: file.filepath,
        originalFilename: file.originalFilename,
        size: file.size
      })
    }
  }
  return result
}

const handleSslCertOpsError = (
  ctx: Parameters<typeof assertWebAdmin>[0],
  error: unknown
) => {
  if (error instanceof SslCertOpsError) {
    response.error(ctx, HTTP_STATUS.BAD_REQUEST, error.message)
    return
  }
  response.error(ctx, HTTP_STATUS.INTERNAL_SERVER_ERROR, '操作失败')
}

// 后台：上传 SSL 证书到 nginx 目录（管理员）
router.post(systemApiWeb('/infra/ssl/upload'), async (ctx) => {
  if ((await assertWebAdmin(ctx)) == null) return

  const files = collectUploadedFiles(
    ctx.request.files as
      | Record<string, KoaUploadedFile | KoaUploadedFile[] | undefined>
      | undefined
  )

  try {
    const data = await uploadSslFiles(files)
    response.success(ctx, data, '证书上传成功')
  } catch (error) {
    handleSslCertOpsError(ctx, error)
  }
})

// 后台：校验 nginx 配置（管理员）
router.post(systemApiWeb('/infra/nginx/test'), async (ctx) => {
  if ((await assertWebAdmin(ctx)) == null) return

  try {
    const data = await runNginxTest()
    response.success(ctx, data, 'nginx 配置校验通过')
  } catch (error) {
    handleSslCertOpsError(ctx, error)
  }
})

// 后台：nginx -t 通过后重载（管理员）
router.post(systemApiWeb('/infra/nginx/apply'), async (ctx) => {
  if ((await assertWebAdmin(ctx)) == null) return

  try {
    const data = await runNginxReload()
    response.success(ctx, data, 'nginx 已重载')
  } catch (error) {
    handleSslCertOpsError(ctx, error)
  }
})
