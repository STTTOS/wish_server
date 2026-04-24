import { ParameterizedContext } from 'koa'

import response from '../utils/response'
import { DefaultState } from '../router/instance'
import { is401BypassPath } from '../constants/paths'
import { HTTP_STATUS } from '../constants/httpStatus'

const customHandle401 = async (
  ctx: ParameterizedContext<DefaultState>,
  next: () => Promise<void>
) => {
  const user = ctx.state.user
  // 抽出来哪些接口不需要用户数据
  if (is401BypassPath(ctx.request.url)) {
    await next()
    return
  }

  if (!user) {
    response.error(ctx, HTTP_STATUS.UNAUTHORIZED, '身份凭证无效, 请重新登陆')
    return
  }
  await next()
}
export default customHandle401
