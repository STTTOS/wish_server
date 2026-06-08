import { v4 } from 'uuid'
import sharp from 'sharp'
import dayjs from 'dayjs'
import { compose } from 'ramda'
import { unlink } from 'fs/promises'
import { join, extname, basename } from 'path'

import { logger } from '../logger'
import { getFileName } from '../utils/file'
import uploadFileToCos from '../utils/uploadFileToCos'
import { mapWithConcurrency } from '../utils/runWithConcurrency'
import { cosDomain, fileNameSpliter, imageCompressRatio } from '../config'

export const IMAGE_UPLOAD_BATCH_MAX = 4
export const IMAGE_UPLOAD_PROCESS_CONCURRENCY = 2
/** 单张图片大小上限（MB） */
export const IMAGE_UPLOAD_MAX_FILE_SIZE_MB = 30
/**
 * formidable 对同一次 multipart 使用全局 _fileSize 累计（非单张计数）。
 * 批量接口仅放宽解析上限；单张 ≤30MB 在业务层过滤，不合规的不影响其他图片。
 */
export const IMAGE_UPLOAD_BATCH_PARSE_LIMIT_MB = 1024

const IMAGE_UPLOAD_MAX_FILE_BYTES = IMAGE_UPLOAD_MAX_FILE_SIZE_MB * 1024 * 1024

const oversizeMessage = (filename: string | null) =>
  `${filename || '图片'} 超过 ${IMAGE_UPLOAD_MAX_FILE_SIZE_MB}MB 大小限制`

export const partitionImagesBySize = (files: UploadedImageFile[]) => {
  const accepted: UploadedImageFile[] = []
  const rejected: BatchProcessedImage['failures'] = []

  for (const file of files) {
    if (file.size > IMAGE_UPLOAD_MAX_FILE_BYTES) {
      rejected.push({
        filename: file.originalFilename,
        message: oversizeMessage(file.originalFilename)
      })
    } else {
      accepted.push(file)
    }
  }

  return { accepted, rejected }
}

const cleanupRejectedUploadFiles = async (
  files: UploadedImageFile[],
  accepted: UploadedImageFile[]
) => {
  const acceptedPaths = new Set(accepted.map((file) => file.filepath))
  await Promise.allSettled(
    files
      .filter((file) => !acceptedPaths.has(file.filepath))
      .map((file) =>
        cleanupLocalImageArtifacts(
          file,
          getCompressedFilePath(file.newFilename)
        )
      )
  )
}

/** 过滤不合规图片并处理合规部分；互不影响 */
export const processImagesBatchWithSizeFilter = async (
  files: UploadedImageFile[]
): Promise<BatchProcessedImage> => {
  const { accepted, rejected } = partitionImagesBySize(files)
  await cleanupRejectedUploadFiles(files, accepted)

  if (accepted.length === 0) {
    return { items: [], failures: rejected }
  }

  const { items, failures } = await processImagesBatch(accepted)
  return { items, failures: [...rejected, ...failures] }
}

export type UploadedImageFile = {
  newFilename: string
  originalFilename: string | null
  filepath: string
  size: number
}

export type ProcessedImage = {
  url: string
  originalUrl: string
  filename: string | null
}

export type BatchProcessedImage = {
  items: ProcessedImage[]
  failures: { filename: string | null; message: string }[]
}

const removeBlanks = (input: string) => input.replaceAll(/\s/g, '')

export const hashAndKeepOriginalName = ({
  originalFilename
}: Pick<UploadedImageFile, 'originalFilename'>) =>
  `${getFileName(
    originalFilename || 'file_unknown'
  )}${fileNameSpliter}${v4()}${extname(originalFilename || '')}`

export const toCosSafeUrl = (url: string, compressed = true) =>
  `https://${cosDomain}/images/${
    compressed ? 'compressed' : 'origin'
  }/${basename(url)}`

const STATIC_DIR = join(__dirname, '../../static')

const getCompressedFilePath = (newFilename: string) =>
  join(STATIC_DIR, newFilename)

/** sharp / COS 任一步失败时，清理本地 origin 与压缩残留 */
const cleanupLocalImageArtifacts = async (
  file: UploadedImageFile,
  compressFilePath: string
) => {
  await Promise.allSettled([unlink(file.filepath), unlink(compressFilePath)])
}

export const processOneImage = async (
  file: UploadedImageFile
): Promise<ProcessedImage> => {
  const compressFilePath = getCompressedFilePath(file.newFilename)

  try {
    logger.info('upload_image:', file.originalFilename, 'start sharp')
    await sharp(file.filepath)
      .rotate()
      // .resize(originWith && Math.floor(originWith * imageCompressRatio))
      .jpeg({ quality: imageCompressRatio * 100 })
      .toFile(compressFilePath)

    const start = Date.now()
    logger.info(
      'upload_image:',
      file.originalFilename,
      'sharp done, upload to cos'
    )
    const [originalUrl, compressedUrl] = await Promise.all([
      uploadFileToCos('images/origin', file.newFilename, file.filepath),
      uploadFileToCos('images/compressed', file.newFilename, compressFilePath)
    ])
    logger.info(
      'upload_image:',
      file.originalFilename,
      'cos done, cost',
      dayjs().diff(start, 'second'),
      's'
    )

    return {
      url: toCosSafeUrl(compressedUrl),
      originalUrl: toCosSafeUrl(originalUrl, false),
      filename: file.originalFilename
    }
  } catch (error) {
    await cleanupLocalImageArtifacts(file, compressFilePath)
    throw error
  }
}

const toFailureMessage = (reason: unknown) => {
  if (reason instanceof Error) return reason.message
  if (typeof reason === 'string') return reason
  return '上传失败'
}

export const processImagesBatch = async (
  files: UploadedImageFile[]
): Promise<BatchProcessedImage> => {
  const settled = await mapWithConcurrency(
    files,
    IMAGE_UPLOAD_PROCESS_CONCURRENCY,
    processOneImage
  )

  const items: ProcessedImage[] = []
  const failures: BatchProcessedImage['failures'] = []

  settled.forEach((result, index) => {
    const file = files[index]
    if (result.status === 'fulfilled') {
      items.push(result.value)
      return
    }
    failures.push({
      filename: file.originalFilename,
      message: toFailureMessage(result.reason)
    })
  })

  return { items, failures }
}

/** formidable onFileBegin：写入 static/origin 并生成稳定文件名 */
export const assignOriginUploadPath =
  (directoryName: string) =>
  (file: {
    filepath: string
    newFilename?: string
    originalFilename?: string | null
  }) => {
    const newFileName = compose(
      removeBlanks,
      hashAndKeepOriginalName
    )({
      originalFilename: file.originalFilename ?? null
    })

    file.filepath = join(STATIC_DIR, directoryName, newFileName)
    file.newFilename = newFileName
  }
