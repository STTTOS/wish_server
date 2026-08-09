import { Prisma, type PrintFileStatus } from '@prisma/printer-client'

import router from '../instance'
import { apiPrefix } from '../../config'
import response from '../../utils/response'
import combinePath from '../../utils/combinePath'
import { HTTP_STATUS } from '../../constants/httpStatus'
import { getCosUploadClient } from '../../services/cosUpload'
import { getDeskIo } from '../../services/deskSocket'
import { printFileRepository } from '../../repositories/printFileRepository'
import { presentPrintFile } from './services/printFilePresenter'
import {
  parsePublicPrintOptions,
  uploadPublicFile,
  type UploadedTempFile
} from './services/uploadFacade'
import { issuePublicUploadToken } from './services/uploadTokenFacade'
import { isWechatMiniConfigured } from '../../services/wechatMini'
import {
  extractUploadToken,
  verifyUploadToken
} from '../../utils/uploadToken'
import { takeMemoryUploadBuffer } from '../../utils/memoryUpload'

const publicApi = combinePath(apiPrefix)('/public')
const filesApi = combinePath(apiPrefix)('/files')

function asSingleFile(
  file: UploadedTempFile | UploadedTempFile[] | undefined
): UploadedTempFile | undefined {
  if (!file) return undefined
  return Array.isArray(file) ? file[0] : file
}

function shopRoom(shopCode: string) {
  return `shop:${shopCode}`
}

function errorStatus(error: unknown, fallback: number) {
  if (error && typeof error === 'object' && 'status' in error) {
    const status = Number((error as { status: number }).status)
    if (Number.isFinite(status) && status >= 400) return status
  }
  return fallback
}

/** 小程序：wx.login code → 短时上传凭证（无授权弹窗） */
router.post(publicApi('/upload-token'), async (ctx) => {
  const body = (ctx.request.body || {}) as {
    code?: unknown
    shopCode?: unknown
    shop?: unknown
  }
  const shopCode =
    (typeof body.shopCode === 'string' && body.shopCode) ||
    (typeof body.shop === 'string' && body.shop) ||
    (typeof ctx.query.shop === 'string' && ctx.query.shop) ||
    (typeof ctx.query.shopCode === 'string' && ctx.query.shopCode) ||
    ''

  try {
    const issued = await issuePublicUploadToken({
      code: body.code,
      shopCode
    })
    response.success(ctx, issued, 'ok')
  } catch (error) {
    response.error(
      ctx,
      errorStatus(error, HTTP_STATUS.INTERNAL_SERVER_ERROR),
      error instanceof Error ? error.message : '获取上传凭证失败'
    )
  }
})

router.post(publicApi('/upload'), async (ctx) => {
  const body = (ctx.request.body || {}) as {
    shopCode?: unknown
    fileName?: unknown
    originalName?: unknown
    printOptions?: unknown
    uploadToken?: unknown
  }
  let queryShop = ''
  if (typeof ctx.query.shop === 'string') {
    queryShop = ctx.query.shop
  } else if (typeof ctx.query.shopCode === 'string') {
    queryShop = ctx.query.shopCode
  }
  const shopCode =
    (typeof body.shopCode === 'string' && body.shopCode) || queryShop || ''

  if (!isWechatMiniConfigured()) {
    response.error(
      ctx,
      HTTP_STATUS.INTERNAL_SERVER_ERROR,
      '服务未配置微信小程序凭证'
    )
    return
  }

  const rawToken = extractUploadToken({
    authorization: ctx.get('authorization'),
    uploadTokenHeader: ctx.get('x-upload-token'),
    formToken: body.uploadToken
  })
  if (!rawToken) {
    response.error(ctx, HTTP_STATUS.UNAUTHORIZED, '缺少上传凭证')
    return
  }

  try {
    const claims = verifyUploadToken(rawToken)
    if (claims.shopCode !== shopCode.trim()) {
      response.error(ctx, HTTP_STATUS.FORBIDDEN, '上传凭证与店铺不匹配')
      return
    }
  } catch (error) {
    response.error(
      ctx,
      errorStatus(error, HTTP_STATUS.UNAUTHORIZED),
      error instanceof Error ? error.message : '上传凭证无效或已过期'
    )
    return
  }

  const files = ctx.request.files || {}
  const file =
    asSingleFile(
      files.file as UploadedTempFile | UploadedTempFile[] | undefined
    ) ||
    asSingleFile(
      files.files as UploadedTempFile | UploadedTempFile[] | undefined
    )

  const buffer = takeMemoryUploadBuffer(file)
  if (!file || !buffer?.length) {
    response.error(ctx, HTTP_STATUS.BAD_REQUEST, '请选择要上传的文件')
    return
  }

  let printOptions
  try {
    printOptions = parsePublicPrintOptions(body.printOptions)
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'printOptions 参数错误'
    response.error(ctx, HTTP_STATUS.BAD_REQUEST, message)
    return
  }

  try {
    const presented = await uploadPublicFile({
      shopCode,
      file,
      buffer,
      clientFileName: body.fileName ?? body.originalName,
      printOptions
    })
    const io = getDeskIo()
    io?.of('/desk').to(shopRoom(presented.shopCode)).emit('file:new', presented)
    response.success(ctx, presented, '上传成功')
  } catch (error) {
    response.error(
      ctx,
      errorStatus(error, HTTP_STATUS.INTERNAL_SERVER_ERROR),
      error instanceof Error ? error.message : '上传失败'
    )
  }
})

router.get(filesApi(''), async (ctx) => {
  const current = ctx.state.user
  if (!current) {
    response.error(ctx, HTTP_STATUS.UNAUTHORIZED, '身份凭证无效, 请重新登陆')
    return
  }
  const rows = await printFileRepository.listByShop(current.shopCode)
  response.success(ctx, rows.map(presentPrintFile))
})

router.patch(filesApi('/:id'), async (ctx) => {
  const current = ctx.state.user
  if (!current) {
    response.error(ctx, HTTP_STATUS.UNAUTHORIZED, '身份凭证无效, 请重新登陆')
    return
  }
  const id = String(ctx.params.id || '')
  const row = await printFileRepository.findActiveById(id)
  if (!row || row.shopCode !== current.shopCode) {
    response.error(ctx, HTTP_STATUS.NOT_FOUND, '文件不存在')
    return
  }

  const body = (ctx.request.body || {}) as {
    status?: unknown
    printOptions?: unknown
    pageCount?: unknown
  }

  const data: Prisma.PrintFileUpdateInput = {}

  if (typeof body.status === 'string') {
    const allowed = ['new', 'printed', 'print_failed'] as const
    if (!(allowed as readonly string[]).includes(body.status)) {
      response.error(ctx, HTTP_STATUS.BAD_REQUEST, '非法 status')
      return
    }
    data.status = body.status as PrintFileStatus
  }

  if (body.printOptions === null) {
    data.printOptions = Prisma.DbNull
  } else if (body.printOptions && typeof body.printOptions === 'object') {
    // Desk may send full PrintOptions (printerName, A5/Legal, etc.) — do not run
    // the stricter public customer parser here.
    data.printOptions = body.printOptions as Prisma.InputJsonValue
  } else if (body.printOptions !== undefined) {
    response.error(ctx, HTTP_STATUS.BAD_REQUEST, 'printOptions 必须是对象')
    return
  }

  if (body.pageCount === null) {
    data.pageCount = null
  } else if (
    typeof body.pageCount === 'number' &&
    Number.isFinite(body.pageCount)
  ) {
    data.pageCount = Math.max(0, Math.floor(body.pageCount))
  }

  if (Object.keys(data).length === 0) {
    response.error(ctx, HTTP_STATUS.BAD_REQUEST, '无更新字段')
    return
  }

  const updated = await printFileRepository.updateActive(id, data)
  const presented = presentPrintFile(updated)
  getDeskIo()
    ?.of('/desk')
    .to(shopRoom(current.shopCode))
    .emit('file:updated', presented)
  response.success(ctx, presented, '已更新')
})

router.delete(filesApi('/:id'), async (ctx) => {
  const current = ctx.state.user
  if (!current) {
    response.error(ctx, HTTP_STATUS.UNAUTHORIZED, '身份凭证无效, 请重新登陆')
    return
  }
  const id = String(ctx.params.id || '')
  const row = await printFileRepository.findActiveById(id)
  if (!row || row.shopCode !== current.shopCode) {
    response.error(ctx, HTTP_STATUS.NOT_FOUND, '文件不存在')
    return
  }

  const purgeCos =
    ctx.query.purgeCos === '1' ||
    ctx.query.purgeCos === 'true' ||
    ctx.query.purgeCos === 'yes'

  let cosPurged = false
  if (purgeCos) {
    try {
      await getCosUploadClient().deleteObject(row.cosKey)
      cosPurged = true
    } catch {
      // 软删仍执行；COS 由定时清理按 cosPurgedAt=null 重试
    }
  }

  await printFileRepository.softDelete(id, { cosPurged })
  getDeskIo()
    ?.of('/desk')
    .to(shopRoom(current.shopCode))
    .emit('file:removed', { id })
  response.success(ctx, { id }, '已删除')
})
