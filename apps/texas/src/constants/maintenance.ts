export const MAINTENANCE_CODE = 2400
export const MAINTENANCE_MESSAGE = '系统维护中'

export const MAINTENANCE_KEY = 'texas:system:maintenance:enabled'

export const MAINTENANCE_HTTP_WHITELIST_PATHS = [
  '/api/client/user/info',
  '/api/client/user/validList'
] as const
