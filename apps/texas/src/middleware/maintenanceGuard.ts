import type { ParameterizedContext } from 'koa'

import response from '../utils/response'
import { DefaultState } from '../router/instance'
import { isAdminUser } from '../utils/isAdminUser'
import { isMaintenanceEnabled } from '../utils/maintenanceSwitch'

const maintenanceWhitelist = new Set([
  '/api/client/user/info',
  '/api/client/user/validList'
])

const MAINTENANCE_CODE = 2400
const MAINTENANCE_MESSAGE = '系统维护中'

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
