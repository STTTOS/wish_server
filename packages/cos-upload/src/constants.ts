export const IMAGE_UPLOAD_BATCH_MAX = 4
export const IMAGE_UPLOAD_PROCESS_CONCURRENCY = 2
/** 单张图片大小上限（MB） */
export const IMAGE_UPLOAD_MAX_FILE_SIZE_MB = 30
/**
 * formidable 对同一次 multipart 使用全局 _fileSize 累计（非单张计数）。
 * 批量接口仅放宽解析上限；单张 ≤30MB 在业务层过滤。
 */
export const IMAGE_UPLOAD_BATCH_PARSE_LIMIT_MB = 1024

export const DEFAULT_COS_BUCKET = 'xuan-1313104191'
export const DEFAULT_COS_REGION = 'ap-chengdu'
export const DEFAULT_COS_DOMAIN = 'cos.wishufree.com'
export const DEFAULT_FILE_NAME_SPLITTER = '__'
export const DEFAULT_IMAGE_COMPRESS_RATIO = 0.3
/** 压缩图最长边像素；等比缩放，小图不放大 */
export const IMAGE_COMPRESS_MAX_EDGE = 2048
