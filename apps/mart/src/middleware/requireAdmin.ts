import { ParameterizedContext } from 'koa'

import response from '../utils/response'
import { DefaultState } from '../router/instance'
import { isAdminOnlyPath } from '../constants/paths'
import { HTTP_STATUS } from '../constants/httpStatus'

const requireAdmin = async (
  ctx: ParameterizedContext<DefaultState>,
  next: () => Promise<void>
) => {
  if (!isAdminOnlyPath(ctx.request.url)) {
    await next()
    return
  }

  if (ctx.state.user?.role !== 'admin') {
    response.error(ctx, HTTP_STATUS.FORBIDDEN, '无操作权限')
    return
  }

  await next()
}

export default requireAdmin
