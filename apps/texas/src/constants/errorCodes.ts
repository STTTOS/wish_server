/**
 * 错误码集中管理：
 * - 保持现有语义不变，只是避免散落硬编码数字。
 */
export const ERROR_CODE = {
  // HTTP-like / auth
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_ERROR: 500,

  // business common
  COMMON_FAIL: 2000,

  // business: validation / domain
  BUSINESS_VALIDATION: 2100,
  USER_NAME_EXISTS: 2100,
  USER_USERNAME_EXISTS: 2101,
  USER_INFO_EXISTS: 2102,

  // system maintenance
  MAINTENANCE: 2400
} as const
