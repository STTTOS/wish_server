import { ParameterizedContext } from 'koa'

import response from '../utils/response'
import { DefaultState } from '../router/instance'
import { is401BypassPath } from '../constants/paths'
import { HTTP_STATUS } from '../constants/httpStatus'

const customHandle401 = async (
  ctx: ParameterizedContext<DefaultState>,
  next: () => Promise<void>
) => {
  if (is401BypassPath(ctx.request.url)) {
    await next()
    return
  }

  // koa-jwt passthrough 时，未登录 user 可能仅为解码失败后的空值
  const jwtUser = ctx.state.user as { id?: number } | undefined
  if (!jwtUser?.id) {
    response.error(ctx, HTTP_STATUS.UNAUTHORIZED, '身份凭证无效, 请重新登陆')
    return
  }

  await next()
}

export default customHandle401
