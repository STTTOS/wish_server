import { HTTP_STATUS } from '../../constants/httpStatus'
import { CLIENT_VERSION_CHECK_WHITELIST_PATHS } from '../../constants/clientVersionConstants'

export const MAINTENANCE_CODE = HTTP_STATUS.SERVICE_UNAVAILABLE
export const MAINTENANCE_MESSAGE =
  '游戏正在火速升级维护, 即将为你带来更好的体验, 具体消息请关注公告'

export const MAINTENANCE_KEY = 'texas:system:maintenance:enabled'

/**
 * 维护期 HTTP 白名单（middleware 直接放行）。
 *
 * 分层约定（避免「全拦死」与「谁都能进」混在一起）：
 * 1. middleware：拦「已带 JWT」的业务接口；管理员放行（见 maintenanceAccess）
 * 2. `/api/client/user/sign`：必须白名单，否则管理员也无法登录；
 *    普通用户/新注册在 sign 处理器内校验身份后仍返回 MAINTENANCE
 * 3. entry-check / status：查询类，供客户端弹窗；进厅拦截语义与 1 一致
 * 4. web login：管理后台入口，保持可登录（后台接口另有 admin 鉴权）
 */
export const MAINTENANCE_HTTP_WHITELIST_PATHS = [
  '/api/client/user/sign',
  '/api/client/user/logout',
  '/api/client/user/info',
  '/api/client/system/maintenance/status',
  '/api/client/system/game/entry-check',
  ...CLIENT_VERSION_CHECK_WHITELIST_PATHS,
  '/api/web/system/maintenance/status',
  '/api/web/system/maintenance/set',
  '/api/web/user/logout',
  '/api/web/user/info',
  '/api/web/user/login',
  /** 官网首页公开榜单：维护中仍可展示 */
  '/api/web/style-stats/score-leaders',
  '/api/web/style-stats/discipline-leaders',
  '/api/client/style-stats/score-leaders'
] as const
