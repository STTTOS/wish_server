/** Redis 中存储的客户端最低 App 版本（与 Expo app.json 的 version 对齐） */
export const CLIENT_MIN_APP_VERSION_KEY = 'texas:system:client:minAppVersion'

/** 客户端 HTTP 403 错误体 `details.type`，与 App 拦截器约定 */
export const APP_VERSION_TOO_LOW_DETAILS_TYPE = 'APP_VERSION_TOO_LOW'

/**
 * 不要求携带 `version` 的 `/api/client/*` 路径（维护态可读接口）。
 * **单一数据源**：`router/system/maintenanceConstants` 中维护 HTTP 白名单须包含本数组（通过展开引用），避免两处漂移。
 */
export const CLIENT_VERSION_CHECK_WHITELIST_PATHS = [
  '/api/client/system/maintenanceNotice'
] as const
