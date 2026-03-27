import type { ParameterizedContext } from 'koa'

import { user } from '../models'
import response from '../utils/response'
import { DefaultState } from '../router/instance'
import { ERROR_CODE } from '../constants/errorCodes'
import { ADMIN_ONLY_PATHS } from '../constants/paths'

const adminOnlyPaths = new Set<string>(ADMIN_ONLY_PATHS)

export default async (
  ctx: ParameterizedContext<DefaultState>,
  next: () => Promise<void>
) => {
  // 只保护少数管理接口：其余直接透传
  if (!adminOnlyPaths.has(ctx.path)) {
    await next()
    return
  }

  const userId = ctx.state.user?.id
  if (!userId) {
    // 理论上 customHandle401 会先拦住未登录请求
    response.error(ctx, ERROR_CODE.UNAUTHORIZED, '身份凭证无效, 请重新登陆')
    return
  }

  const admin = await user.findUnique({
    where: { id: userId },
    select: { isAdmin: true }
  })

  if (!admin?.isAdmin) {
    response.error(ctx, ERROR_CODE.FORBIDDEN, '无权限')
    return
  }

  await next()
}
