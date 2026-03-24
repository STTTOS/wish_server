import type { ParameterizedContext } from 'koa'

import { user } from '../models'
import response from '../utils/response'
import { DefaultState } from '../router/instance'

const adminOnlyPaths = new Set([
  '/api/web/announcement/list',
  '/api/web/announcement/validList',
  '/api/web/announcement/detail',
  '/api/web/announcement/update',
  '/api/web/announcement/create',
  '/api/web/announcement/changeStatus',
  '/api/web/announcement/delete'
])

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
    response.error(ctx, 401, '身份凭证无效, 请重新登陆')
    return
  }

  const admin = await user.findUnique({
    where: { id: userId },
    select: { isAdmin: true }
  })

  if (!admin?.isAdmin) {
    response.error(ctx, 403, '无权限')
    return
  }

  await next()
}
