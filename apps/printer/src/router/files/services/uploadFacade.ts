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

export async function uploadPublicFile(input: {
  shopCode: string
  file: UploadedTempFile
}) {
  const shopCode = input.shopCode.trim()
  if (!shopCode) {
    throw Object.assign(new Error('shopCode 不能为空'), { status: 400 })
  }

  const originalName =
    input.file.originalFilename || input.file.newFilename || 'file'
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
    size
  })

  return presentPrintFile(row)
}
