import { extname, basename } from 'path'
import { unlink } from 'fs/promises'
import { v4 as uuidv4 } from 'uuid'
import dayjs from 'dayjs'

import { PRINTING_COS_PREFIX } from '../../../config'
import { getCosUploadClient } from '../../../services/cosUpload'
import { printFileRepository } from '../../../repositories/printFileRepository'
import { presentPrintFile } from './printFilePresenter'

export type UploadedTempFile = {
  filepath: string
  originalFilename?: string | null
  newFilename?: string
  mimetype?: string | null
  size?: number
}

const ALLOWED_EXT = new Set([
  '.pdf',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.bmp',
  '.tif',
  '.tiff'
])

function guessMime(ext: string, fallback?: string | null) {
  const map: Record<string, string> = {
    '.pdf': 'application/pdf',
    '.doc': 'application/msword',
    '.docx':
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx':
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
    '.tif': 'image/tiff',
    '.tiff': 'image/tiff'
  }
  return map[ext] || fallback || 'application/octet-stream'
}

function sanitizeFileName(name: string) {
  return name.replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 180)
}

/** Mini program temp path: `up_<ms>_<name>` — strip when multipart leaks it. */
const UPLOAD_TEMP_NAME_PREFIX = /^up_\d+_/

/**
 * Prefer explicit form `fileName` / `originalName`; fall back to multipart
 * filename and strip the local upload-temp prefix if present.
 */
export function resolveOriginalName(
  preferred: unknown,
  multipartName?: string | null,
  fallback = 'file'
): string {
  const fromForm =
    typeof preferred === 'string' && preferred.trim() ? preferred.trim() : ''
  const raw = fromForm || (multipartName || '').trim() || fallback
  const base = basename(raw)
  const cleaned = base.replace(UPLOAD_TEMP_NAME_PREFIX, '') || base
  return cleaned.slice(0, 500) || fallback
}

/** Customer-facing print intent from public upload (mini program / H5). */
export type PublicPrintOptions = {
  color: 'bw' | 'color'
  paperSize: 'A4' | 'A3'
  duplex: boolean
  copies: number
}

export class PrintOptionsParseError extends Error {
  status = 400
  constructor(message: string) {
    super(message)
    this.name = 'PrintOptionsParseError'
  }
}

function parseDuplex(raw: unknown): boolean {
  if (typeof raw === 'boolean') return raw
  if (typeof raw === 'number') return raw !== 0
  if (typeof raw === 'string') {
    const v = raw.trim().toLowerCase()
    if (v === 'true' || v === '1' || v === 'yes') return true
    if (v === 'false' || v === '0' || v === 'no' || v === '') return false
  }
  return false
}

/**
 * Accept JSON object or JSON string from multipart formData.
 * - missing / empty → null (shop defaults on desk)
 * - malformed JSON / non-object → 400
 * - object with bad fields → coerce to safe defaults (do not drop the whole options bag)
 */
export function parsePublicPrintOptions(
  raw: unknown
): PublicPrintOptions | null {
  if (raw == null) return null
  if (typeof raw === 'string' && !raw.trim()) return null

  let value: unknown = raw
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw.trim())
    } catch {
      throw new PrintOptionsParseError('printOptions 不是合法 JSON')
    }
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new PrintOptionsParseError('printOptions 必须是对象')
  }

  const obj = value as Record<string, unknown>

  const color: PublicPrintOptions['color'] =
    obj.color === 'color' ? 'color' : 'bw'

  const paperSize: PublicPrintOptions['paperSize'] =
    obj.paperSize === 'A3' ? 'A3' : 'A4'

  const duplex = parseDuplex(obj.duplex)

  const copiesRaw = obj.copies
  const copiesNum =
    typeof copiesRaw === 'number'
      ? copiesRaw
      : typeof copiesRaw === 'string'
        ? Number(copiesRaw)
        : NaN
  const copies = Number.isFinite(copiesNum)
    ? Math.min(99, Math.max(1, Math.floor(copiesNum)))
    : 1

  return { color, paperSize, duplex, copies }
}

export async function uploadPublicFile(input: {
  shopCode: string
  file: UploadedTempFile
  /** Explicit customer-facing name from multipart form (preferred). */
  clientFileName?: unknown
  printOptions?: PublicPrintOptions | null
}) {
  const shopCode = input.shopCode.trim()
  if (!shopCode) {
    throw Object.assign(new Error('shopCode 不能为空'), { status: 400 })
  }

  const originalName = resolveOriginalName(
    input.clientFileName,
    input.file.originalFilename || input.file.newFilename
  )
  const ext = extname(originalName).toLowerCase()
  if (!ALLOWED_EXT.has(ext)) {
    throw Object.assign(new Error('不支持的文件类型'), { status: 400 })
  }

  const size = input.file.size || 0
  if (size <= 0) {
    throw Object.assign(new Error('空文件'), { status: 400 })
  }

  const safeName = sanitizeFileName(basename(originalName))
  const objectName = `${uuidv4()}-${safeName}`
  const prefix = `${PRINTING_COS_PREFIX}/${shopCode}/${dayjs().format('YYYY/MM')}`

  const cos = getCosUploadClient()
  const location = await cos.uploadFileToCos(
    prefix,
    objectName,
    input.file.filepath
  )
  const cosKey = `${prefix}/${objectName}`.replace(/\\/g, '/')
  const cosUrl = location.startsWith('http')
    ? location
    : `https://${location}`

  await unlink(input.file.filepath).catch(() => undefined)

  const row = await printFileRepository.create({
    shopCode,
    originalName,
    cosKey,
    cosUrl,
    mime: guessMime(ext, input.file.mimetype),
    size,
    printOptions: input.printOptions ?? undefined
  })

  return presentPrintFile(row)
}
