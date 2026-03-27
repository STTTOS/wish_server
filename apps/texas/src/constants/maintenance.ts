export const MAINTENANCE_CODE = 2400
export const MAINTENANCE_MESSAGE =
  '游戏正在火速升级维护, 即将为你带来更好的体验, 具体消息请关注公告'

export const MAINTENANCE_KEY = 'texas:system:maintenance:enabled'

export const MAINTENANCE_HTTP_WHITELIST_PATHS = [
  '/api/client/user/info',
  '/api/client/system/maintenance/status',
  '/api/client/system/maintenanceNotice',
  '/api/web/system/maintenance/status',
  '/api/web/system/maintenance/set'
] as const
