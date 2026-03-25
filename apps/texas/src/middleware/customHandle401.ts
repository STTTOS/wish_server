import { toLower } from 'ramda'
import { ParameterizedContext } from 'koa'

import response from '../utils/response'
import { DefaultState } from '../router/instance'

// 如下的接口, 即使解析不到用户数据, 也不做401跳转
const paths = [
  /^\/api\/client\/user\/sign$/,
  /^\/api\/web\/user\/login/,
  /^\/api\/client\/user\/info/,
  /^\/api\/web\/user\/info/,
  /^\/api\/client\/user\/info/,
  /^\/api\/client\/game\/config$/
]

export const isPublic401Path = (url: string) =>
  paths.some((path) => {
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
    response.success(ctx, null, '身份凭证无效, 请重新登陆', 401)
    return
  }
  await next()
}
export default customHandle401
