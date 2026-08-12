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
export const UPLOAD_MAX_FILE_SIZE_MB = 200

/** 小程序上传凭证有效期（秒），默认 30 分钟 */
export const UPLOAD_TOKEN_TTL_SECONDS = Number(
  process.env.UPLOAD_TOKEN_TTL_SECONDS || 30 * 60
)

/** 公共上传限流：每 IP 每分钟次数（批量多选需高于默认防刷阈值） */
export const PUBLIC_UPLOAD_RATE_MAX = Number(
  process.env.PUBLIC_UPLOAD_RATE_MAX || 200
)

/** 公共上传凭证限流：每 IP 每分钟次数 */
export const PUBLIC_UPLOAD_TOKEN_RATE_MAX = Number(
  process.env.PUBLIC_UPLOAD_TOKEN_RATE_MAX || 60
)
