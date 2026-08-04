import { ParameterizedContext } from 'koa'

import response from '../utils/response'
import { DefaultState } from '../router/instance'
import { is401BypassPath } from '../constants/paths'
import { HTTP_STATUS } from '../constants/httpStatus'
import { userRepository } from '../repositories/userRepository'

const attachCurrentUser = async (
  ctx: ParameterizedContext<DefaultState>,
  next: () => Promise<void>
) => {
  const userId = (ctx.state.user as { id?: number } | undefined)?.id
  if (!userId) {
    await next()
    return
  }

  const record = await userRepository.findAuthById(userId)
  if (!record) {
    if (is401BypassPath(ctx.request.url)) {
      ctx.state.user = undefined
      await next()
      return
    }
    response.error(ctx, HTTP_STATUS.UNAUTHORIZED, '身份凭证无效, 请重新登陆')
    return
  }

  ctx.state.user = record
  await next()
}

export default attachCurrentUser
