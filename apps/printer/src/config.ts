export const port = process.env.SERVER_PORT || '7503'

export const apiPrefix = '/api'

export const timeFormat = 'YYYY-MM-DD HH:mm:ss'

export const cacheTime = 30 * 24 * 60 * 60

export const tokenValidatedTime = 30 * 24 * 60 * 60

/** COS 打印中转前缀 */
export const PRINTING_COS_PREFIX = 'printing'

/** 临时文件保留天数 */
export const PRINT_FILE_RETENTION_DAYS = Number(
  process.env.PRINT_FILE_RETENTION_DAYS || 3
)

/** 上传单文件上限（MB） */
export const UPLOAD_MAX_FILE_SIZE_MB = 50
