import type { ParameterizedContext } from 'koa'

import response from './response'
import { isAdminUser } from './isAdminUser'
import { DefaultState } from '../router/instance'
import { isMaintenanceEnabled } from './maintenanceSwitch'
import {
  MAINTENANCE_CODE,
  MAINTENANCE_MESSAGE
} from '../router/system/maintenanceConstants'

/**
 * 维护期访问策略（单一判定，供 HTTP guard / 登录 / entry-check / WS 对齐）：
 * - 维护关：不拦
 * - 维护开 + 管理员：放行
 * - 维护开 + 非管理员 / 未识别用户：拦截
 */
export async function isBlockedByMaintenance(
  userId?: number | null
): Promise<boolean> {
  const enabled = await isMaintenanceEnabled()
  if (!enabled) return false
  if (userId == null || userId <= 0) return true
  return !(await isAdminUser(userId))
}

/** 写入与 middleware 一致的维护 503 响应体（客户端 http 会弹 GlobalMaintenanceModal） */
export function respondMaintenanceBlocked(
  ctx: ParameterizedContext<DefaultState>
) {
  response.error(ctx, MAINTENANCE_CODE, MAINTENANCE_MESSAGE, {
    type: 'MAINTENANCE',
    enabled: true
  })
}
