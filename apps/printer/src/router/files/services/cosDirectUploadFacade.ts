import { extname, basename } from 'path'
import { v4 as uuidv4 } from 'uuid'
import dayjs from 'dayjs'

import {
  PRINTING_COS_PREFIX,
  UPLOAD_MAX_FILE_SIZE_MB
} from '../../../config'
import { getCosUploadClient } from '../../../services/cosUpload'
import { issuePrintUploadSts } from '../../../services/cosSts'
import { printFileRepository } from '../../../repositories/printFileRepository'
import { userRepository } from '../../../repositories/userRepository'
import { presentPrintFile } from './printFilePresenter'
import {
  guessMime,
  resolveOriginalName,
  sanitizeFileName,
  type PublicPrintOptions
} from './uploadFacade'

const SHOP_CODE_RE = /^[a-zA-Z0-9_-]{1,64}$/

const ALLOWED_EXT = new Set([
  '.pdf',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.cdr',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.bmp',
  '.tif',
  '.tiff'
])

const MAX_BYTES = UPLOAD_MAX_FILE_SIZE_MB * 1024 * 1024

async function assertShop(shopCodeRaw: string) {
  const shopCode = shopCodeRaw.trim()
  if (!shopCode) {
    throw Object.assign(new Error('shopCode 不能为空'), { status: 400 })
  }
  if (!SHOP_CODE_RE.test(shopCode)) {
    throw Object.assign(new Error('shopCode 非法'), { status: 400 })
  }
  if (!(await userRepository.existsByShopCode(shopCode))) {
    throw Object.assign(new Error('店铺不存在或未开通'), { status: 403 })
  }
  return shopCode
}

function assertExt(originalName: string) {
  const ext = extname(originalName).toLowerCase()
  if (!ALLOWED_EXT.has(ext)) {
    throw Object.assign(new Error('不支持的文件类型'), { status: 400 })
  }
  return { ext, mime: guessMime(ext) }
}

function assertFileMeta(input: {
  originalName: string
  size: number
}) {
  const { ext, mime } = assertExt(input.originalName)
  if (!Number.isFinite(input.size) || input.size <= 0) {
    throw Object.assign(new Error('文件大小无效'), { status: 400 })
  }
  if (input.size > MAX_BYTES) {
    throw Object.assign(
      new Error(`文件超过 ${UPLOAD_MAX_FILE_SIZE_MB}MB`),
      { status: 400 }
    )
  }
  return { ext, mime }
}

function mintCosKey(shopCode: string, originalName: string) {
  const safeName = sanitizeFileName(basename(originalName))
  const objectName = `${uuidv4()}-${safeName}`
  const prefix = `${PRINTING_COS_PREFIX}/${shopCode}/${dayjs().format('YYYY/MM')}`
  return `${prefix}/${objectName}`.replace(/\\/g, '/')
}

/** 签发 COS 直传临时密钥（单对象 Key）。 */
export async function issueCosDirectUpload(input: {
  shopCode: string
  fileName: unknown
  size: unknown
}) {
  const shopCode = await assertShop(input.shopCode)
  const originalName = resolveOriginalName(input.fileName, null)
  const size =
    typeof input.size === 'number'
      ? input.size
      : typeof input.size === 'string'
        ? Number(input.size)
        : NaN
  const { mime } = assertFileMeta({ originalName, size })
  const cosKey = mintCosKey(shopCode, originalName)
  const sts = await issuePrintUploadSts({ shopCode, cosKey })

  return {
    ...sts,
    originalName,
    mime,
    size,
    shopCode
  }
}

/** 直传完成后登记：headObject 校验 → DB → 返回与旧 /upload 相同结构。 */
export async function completeCosDirectUpload(input: {
  shopCode: string
  cosKey: unknown
  originalName?: unknown
  fileName?: unknown
  printOptions?: PublicPrintOptions | null
}) {
  const shopCode = await assertShop(input.shopCode)
  const cosKey =
    typeof input.cosKey === 'string' ? input.cosKey.replace(/^\/+/, '').trim() : ''
  if (!cosKey) {
    throw Object.assign(new Error('cosKey 不能为空'), { status: 400 })
  }

  const expectedPrefix = `${PRINTING_COS_PREFIX}/${shopCode}/`
  if (!cosKey.startsWith(expectedPrefix)) {
    throw Object.assign(new Error('cosKey 与店铺不匹配'), { status: 403 })
  }

  const originalName = resolveOriginalName(
    input.fileName ?? input.originalName,
    basename(cosKey)
  )
  const { mime } = assertExt(originalName)

  const cos = getCosUploadClient()
  let head: { size: number; contentType: string }
  try {
    head = await cos.headObject(cosKey)
  } catch {
    throw Object.assign(new Error('COS 上未找到已上传文件'), { status: 400 })
  }

  if (!head.size || head.size <= 0) {
    throw Object.assign(new Error('空文件'), { status: 400 })
  }
  if (head.size > MAX_BYTES) {
    throw Object.assign(
      new Error(`文件超过 ${UPLOAD_MAX_FILE_SIZE_MB}MB`),
      { status: 400 }
    )
  }

  const cosUrl = `https://${cos.bucket}.cos.${cos.region}.myqcloud.com/${cosKey}`

  const row = await printFileRepository.create({
    shopCode,
    originalName,
    cosKey,
    cosUrl,
    mime: mime || head.contentType || 'application/octet-stream',
    size: head.size,
    printOptions: input.printOptions ?? undefined
  })

  return presentPrintFile(row)
}
