import type { ParameterizedContext } from 'koa'
import type { DefaultState } from '../router/instance'

import response from '../utils/response'
import { isPublic401Path } from './customHandle401'
import { HTTP_STATUS } from '../constants/httpStatus'
import { getLoginSession, type LoginScope } from '../utils/loginSession'

/**
 * 单设备登录控制：
 * token 内 sessionId 必须等于该用户当前最新 sessionId。
 * 若用户在新设备登录，旧 token 会在下一次请求时失效。
 */
export default async (
  ctx: ParameterizedContext<DefaultState>,
  next: () => Promise<void>
) => {
  if (isPublic401Path(ctx.request.url)) {
    await next()
    return
  }

  let scope: LoginScope | null = null
  if (ctx.path.startsWith('/api/client/')) {
    scope = 'client'
  } else if (ctx.path.startsWith('/api/web/')) {
    scope = 'web'
  }
  if (!scope) {
    await next()
    return
  }

  const parsedUser = ctx.state.user
  if (!parsedUser?.id) {
    await next()
    return
  }

  const latestSession = await getLoginSession(parsedUser.id, scope)
  if (!latestSession) {
    response.error(ctx, HTTP_STATUS.UNAUTHORIZED, '登录已失效，请重新登录')
    return
  }
  if (latestSession.sessionId !== parsedUser.sessionId) {
    response.error(
      ctx,
      HTTP_STATUS.UNAUTHORIZED,
      '账号已在其他设备登录，请重新登录'
    )
    return
  }

  await next()
}
