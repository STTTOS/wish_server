import { toLower } from 'ramda'
import { ParameterizedContext } from 'koa'

import { user } from '../models'
import response from '../utils/response'
import { apiNeededToAuth } from '../config'
import { DefaultState } from '../router/instance'

const requireAuthMiddleware = async (
  ctx: ParameterizedContext<DefaultState>,
  next: () => Promise<void>
) => {
  if (
    apiNeededToAuth.some((url) => toLower(url) === toLower(ctx.request.url))
  ) {
    const userId = ctx.state.user.id
    const data = await user.findUnique({ where: { id: userId } })
    if (data?.role !== 'admin') {
      response.success(ctx, null, '无操作权限', 403)
    }
  } else {
    await next()
  }
}
export default requireAuthMiddleware
