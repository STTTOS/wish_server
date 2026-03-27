import { toLower } from 'ramda'
import { ParameterizedContext } from 'koa'

import response from '../utils/response'
import { DefaultState } from '../router/instance'
import { ERROR_CODE } from '../constants/errorCodes'
import { PUBLIC_401_PATHS } from '../constants/paths'

export const isPublic401Path = (url: string) =>
  PUBLIC_401_PATHS.some((path) => {
    if (typeof path === 'string') return toLower(path) === toLower(url)
    return path.test(url)
  })

const customHandle401 = async (
  ctx: ParameterizedContext<DefaultState>,
  next: () => Promise<void>
) => {
  const user = ctx.state.user
  // 抽出来哪些接口不需要用户数据
  if (isPublic401Path(ctx.request.url)) {
    await next()
    return
  }

  if (!user) {
    response.success(
      ctx,
      null,
      '身份凭证无效, 请重新登陆',
      ERROR_CODE.UNAUTHORIZED
    )
    return
  }
  await next()
}
export default customHandle401
