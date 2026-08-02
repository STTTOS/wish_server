import Cos from 'cos-nodejs-sdk-v5'
import dayjs from 'dayjs'
import sharp from 'sharp'
import { v4 } from 'uuid'
import { unlink } from 'fs/promises'
import { basename, extname, join } from 'path'

import {
  DEFAULT_COS_BUCKET,
  DEFAULT_COS_DOMAIN,
  DEFAULT_COS_REGION,
  DEFAULT_FILE_NAME_SPLITTER,
  DEFAULT_IMAGE_COMPRESS_RATIO,
  IMAGE_COMPRESS_MAX_EDGE,
  IMAGE_UPLOAD_BATCH_MAX,
  IMAGE_UPLOAD_BATCH_PARSE_LIMIT_MB,
  IMAGE_UPLOAD_MAX_FILE_SIZE_MB,
  IMAGE_UPLOAD_PROCESS_CONCURRENCY
} from './constants'
import { mapWithConcurrency } from './mapWithConcurrency'
import type {
  BatchProcessedImage,
  CosUploadClientOptions,
  ProcessedImage,
  UploadedImageFile
} from './types'

const IMAGE_UPLOAD_MAX_FILE_BYTES = IMAGE_UPLOAD_MAX_FILE_SIZE_MB * 1024 * 1024

const getFileName = (name: string) => basename(name, extname(name))
const removeBlanks = (input: string) => input.replaceAll(/\s/g, '')

export function createCosUploadClient(options: CosUploadClientOptions) {
  const bucket = options.bucket || DEFAULT_COS_BUCKET
  const region = options.region || DEFAULT_COS_REGION
  const cosDomain = options.cosDomain || DEFAULT_COS_DOMAIN
  const fileNameSplitter =
    options.fileNameSplitter || DEFAULT_FILE_NAME_SPLITTER
  const imageCompressRatio =
    options.imageCompressRatio ?? DEFAULT_IMAGE_COMPRESS_RATIO
  const staticDir = options.staticDir
  const logger = options.logger

  if (!options.secretId || !options.secretKey) {
    throw new Error('COS_SECRET_ID / COS_SECRET_KEY is required')
  }

  const cos = new Cos({
    SecretId: options.secretId,
    SecretKey: options.secretKey
  })

  const toCosObjectKey = (prefix: string, fileName: string) =>
    `${prefix}/${fileName}`.replace(/\\/g, '/')

  const uploadFileToCos = (
    prefix: string,
    fileName: string,
    filePath: string
  ) =>
    new Promise<string>((resolve, reject) => {
      cos.uploadFile(
        {
          Bucket: bucket,
          Region: region,
          Key: toCosObjectKey(prefix, fileName),
          FilePath: filePath,
          SliceSize: 1024 * 1024 * 3
        },
        (err, data) => {
          if (!err) resolve(data.Location)
          else reject(err.message)
        }
      )
    })

  /** 压缩图走内存，避免再落盘 */
  const uploadBufferToCos = (
    prefix: string,
    fileName: string,
    body: Buffer
  ) =>
    new Promise<string>((resolve, reject) => {
      cos.putObject(
        {
          Bucket: bucket,
          Region: region,
          Key: toCosObjectKey(prefix, fileName),
          Body: body,
          ContentLength: body.length,
          ContentType: 'image/jpeg'
        },
        (err, data) => {
          if (!err) resolve(data.Location)
          else reject(err?.message || err)
        }
      )
    })

  const toCosSafeUrl = (url: string, compressed = true) =>
    `https://${cosDomain}/images/${
      compressed ? 'compressed' : 'origin'
    }/${basename(url)}`

  const hashAndKeepOriginalName = ({
    originalFilename
  }: Pick<UploadedImageFile, 'originalFilename'>) =>
    `${getFileName(
      originalFilename || 'file_unknown'
    )}${fileNameSplitter}${v4()}${extname(originalFilename || '')}`

  const cleanupLocalOriginFile = async (file: UploadedImageFile) => {
    await unlink(file.filepath).catch(() => undefined)
  }

  const oversizeMessage = (filename: string | null) =>
    `${filename || '图片'} 超过 ${IMAGE_UPLOAD_MAX_FILE_SIZE_MB}MB 大小限制`

  const partitionImagesBySize = (files: UploadedImageFile[]) => {
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
        .map((file) => cleanupLocalOriginFile(file))
    )
  }

  const processOneImage = async (
    file: UploadedImageFile
  ): Promise<ProcessedImage> => {
    try {
      logger?.info('upload_image:', file.originalFilename, 'start sharp')
      const compressedBuffer = await sharp(file.filepath)
        .rotate()
        .resize({
          width: IMAGE_COMPRESS_MAX_EDGE,
          height: IMAGE_COMPRESS_MAX_EDGE,
          fit: 'inside',
          withoutEnlargement: true
        })
        .jpeg({ quality: imageCompressRatio * 100 })
        .toBuffer()

      const start = Date.now()
      logger?.info(
        'upload_image:',
        file.originalFilename,
        'sharp done, upload to cos'
      )
      const [originalUrl, compressedUrl] = await Promise.all([
        uploadFileToCos('images/origin', file.newFilename, file.filepath),
        uploadBufferToCos(
          'images/compressed',
          file.newFilename,
          compressedBuffer
        )
      ])
      logger?.info(
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
      await cleanupLocalOriginFile(file)
      throw error
    }
  }

  const toFailureMessage = (reason: unknown) => {
    if (reason instanceof Error) return reason.message
    if (typeof reason === 'string') return reason
    return '上传失败'
  }

  const processImagesBatch = async (
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

  const processImagesBatchWithSizeFilter = async (
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

  /** formidable onFileBegin：写入 static/<dir> 并生成稳定文件名 */
  const assignOriginUploadPath =
    (directoryName: string) =>
    (file: {
      filepath: string
      newFilename?: string
      originalFilename?: string | null
    }) => {
      const newFileName = removeBlanks(
        hashAndKeepOriginalName({
          originalFilename: file.originalFilename ?? null
        })
      )

      file.filepath = join(staticDir, directoryName, newFileName)
      file.newFilename = newFileName
    }

  return {
    uploadFileToCos,
    toCosSafeUrl,
    hashAndKeepOriginalName,
    partitionImagesBySize,
    processOneImage,
    processImagesBatch,
    processImagesBatchWithSizeFilter,
    assignOriginUploadPath,
    constants: {
      IMAGE_UPLOAD_BATCH_MAX,
      IMAGE_UPLOAD_PROCESS_CONCURRENCY,
      IMAGE_UPLOAD_MAX_FILE_SIZE_MB,
      IMAGE_UPLOAD_BATCH_PARSE_LIMIT_MB
    }
  }
}

export type CosUploadClient = ReturnType<typeof createCosUploadClient>
