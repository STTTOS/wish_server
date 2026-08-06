export { createCosUploadClient } from './createCosUploadClient'
export type { CosUploadClient } from './createCosUploadClient'
export type {
  BatchProcessedImage,
  CosUploadClientOptions,
  CosUploadLogger,
  ProcessedImage,
  UploadedImageBuffer,
  UploadedImageFile
} from './types'
export {
  DEFAULT_COS_BUCKET,
  DEFAULT_COS_DOMAIN,
  DEFAULT_COS_REGION,
  DEFAULT_FILE_NAME_SPLITTER,
  DEFAULT_IMAGE_COMPRESS_RATIO,
  IMAGE_UPLOAD_BATCH_MAX,
  IMAGE_UPLOAD_BATCH_PARSE_LIMIT_MB,
  IMAGE_UPLOAD_MAX_FILE_SIZE_MB,
  IMAGE_UPLOAD_PROCESS_CONCURRENCY
} from './constants'
