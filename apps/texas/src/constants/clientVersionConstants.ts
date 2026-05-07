/** Redis 中存储的客户端最低 App 版本（与 Expo app.json 的 version 对齐） */
export const CLIENT_MIN_APP_VERSION_KEY = 'texas:system:client:minAppVersion'

/** 客户端 HTTP 403 错误体 `details.type`，与 App 拦截器约定 */
export const APP_VERSION_TOO_LOW_DETAILS_TYPE = 'APP_VERSION_TOO_LOW'

/**
 * 不要求携带 `version` 的客户端路径（极旧包或仅读状态类接口）。
 * 其余 `/api/client/*` 均须 `version` 且不低于服务端最低版本。
 */
export const CLIENT_VERSION_CHECK_WHITELIST_PATHS = [
  '/api/client/system/maintenance/status',
  '/api/client/system/maintenanceNotice'
] as const
