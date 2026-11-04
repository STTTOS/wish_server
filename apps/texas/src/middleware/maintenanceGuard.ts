import type { ParameterizedContext } from 'koa'

import { DefaultState } from '../router/instance'
import { MAINTENANCE_HTTP_WHITELIST_PATHS } from '../router/system/maintenanceConstants'
import {
  isBlockedByMaintenance,
  respondMaintenanceBlocked
} from '../utils/maintenanceAccess'

const maintenanceWhitelist = new Set<string>(MAINTENANCE_HTTP_WHITELIST_PATHS)

/**
 * 已登录请求的维护闸门（依赖 koa-jwt 已写入 ctx.state.user）。
 * `/user/sign` 等鉴权前路径在白名单内，由登录处理器自行按账号身份拦截。
 */
export default async (
  ctx: ParameterizedContext<DefaultState>,
  next: () => Promise<void>
) => {
  if (maintenanceWhitelist.has(ctx.path)) {
    await next()
    return
  }

  const blocked = await isBlockedByMaintenance(ctx.state.user?.id)
  if (!blocked) {
    await next()
    return
  }

  respondMaintenanceBlocked(ctx)
}
