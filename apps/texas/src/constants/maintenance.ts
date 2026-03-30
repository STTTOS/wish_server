import { HTTP_STATUS } from './httpStatus'

export const MAINTENANCE_CODE = HTTP_STATUS.SERVICE_UNAVAILABLE
export const MAINTENANCE_MESSAGE =
  '游戏正在火速升级维护, 即将为你带来更好的体验, 具体消息请关注公告'

export const MAINTENANCE_KEY = 'texas:system:maintenance:enabled'

export const MAINTENANCE_HTTP_WHITELIST_PATHS = [
  '/api/client/user/info',
  '/api/client/user/logout',
  '/api/client/system/maintenance/status',
  '/api/client/system/maintenanceNotice',
  '/api/web/system/maintenance/status',
  '/api/web/system/maintenance/set',
  '/api/web/user/logout',
  '/api/web/user/info',
  '/api/web/user/login'
] as const
