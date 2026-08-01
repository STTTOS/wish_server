import { join } from 'path'
import { createCosUploadClient } from '@wishufree/cos-upload'

import { logger } from '../logger'
import { cosDomain, fileNameSpliter, imageCompressRatio } from '../config'

const client = createCosUploadClient({
  secretId: process.env.COS_SECRET_ID || '',
  secretKey: process.env.COS_SECRET_KEY || '',
  cosDomain,
  staticDir: join(__dirname, '../../static'),
  fileNameSplitter: fileNameSpliter,
  imageCompressRatio,
  logger: {
    info: (...args) => {
      logger.info(args[0], ...args.slice(1))
    },
    warn: (...args) => {
      logger.warn(args[0], ...args.slice(1))
    },
    error: (...args) => {
      logger.error(args[0], ...args.slice(1))
    }
  }
})

export const {
  IMAGE_UPLOAD_BATCH_MAX,
  IMAGE_UPLOAD_PROCESS_CONCURRENCY,
  IMAGE_UPLOAD_MAX_FILE_SIZE_MB,
  IMAGE_UPLOAD_BATCH_PARSE_LIMIT_MB
} = client.constants

export const {
  uploadFileToCos,
  toCosSafeUrl,
  hashAndKeepOriginalName,
  partitionImagesBySize,
  processOneImage,
  processImagesBatch,
  processImagesBatchWithSizeFilter,
  assignOriginUploadPath
} = client

export type {
  UploadedImageFile,
  ProcessedImage,
  BatchProcessedImage
} from '@wishufree/cos-upload'
