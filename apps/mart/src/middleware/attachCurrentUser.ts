import { ParameterizedContext } from 'koa'

import { user } from '../models'
import response from '../utils/response'
import { DefaultState } from '../router/instance'
import { is401BypassPath } from '../constants/paths'
import { HTTP_STATUS } from '../constants/httpStatus'

/**
 * 将 JWT 中的 id 补全为当前用户（含 role）。
 * 放在 401 之后：公开接口跳过；受保护接口要求账号仍存在。
 */
const attachCurrentUser = async (
  ctx: ParameterizedContext<DefaultState>,
  next: () => Promise<void>
) => {
  if (is401BypassPath(ctx.request.url)) {
    await next()
    return
  }

  const userId = (ctx.state.user as { id?: number } | undefined)?.id
  if (!userId) {
    await next()
    return
  }

  const record = await user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, username: true }
  })

  if (!record) {
    response.error(ctx, HTTP_STATUS.UNAUTHORIZED, '身份凭证无效, 请重新登陆')
    return
  }

  ctx.state.user = record
  await next()
}

export default attachCurrentUser
