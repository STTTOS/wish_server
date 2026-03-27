import type { ParameterizedContext } from 'koa'

import response from '../utils/response'
import { DefaultState } from '../router/instance'
import { isAdminUser } from '../utils/isAdminUser'
import { isMaintenanceEnabled } from '../utils/maintenanceSwitch'
import {
  MAINTENANCE_CODE,
  MAINTENANCE_MESSAGE,
  MAINTENANCE_HTTP_WHITELIST_PATHS
} from '../constants/maintenance'

const maintenanceWhitelist = new Set<string>(MAINTENANCE_HTTP_WHITELIST_PATHS)

export default async (
  ctx: ParameterizedContext<DefaultState>,
  next: () => Promise<void>
) => {
  if (maintenanceWhitelist.has(ctx.path)) {
    await next()
    return
  }

  const enabled = await isMaintenanceEnabled()
  if (!enabled) {
    await next()
    return
  }

  const userId = ctx.state.user?.id
  const adminPassed = await isAdminUser(userId)
  if (adminPassed) {
    await next()
    return
  }

  response.error(ctx, MAINTENANCE_CODE, MAINTENANCE_MESSAGE)
}
