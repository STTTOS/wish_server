import { toLower } from 'ramda'
import { ParameterizedContext } from 'koa'

import response from '../utils/response'
import { DefaultState } from '../router/instance'

// 如下的接口, 即使解析不到用户数据, 也不做401跳转
const paths = [
  /^\/api\/user\/(logout|signin|recommend|all|card|info)/,
  /^\/api\/article\/(detail|similar|count|clientList|visibleUsers)/,
  /\/images\/.*/,
  '/api/tag/all',
  '/api/tag/view/platform',
  '/api/tag/view/personal',
  '/api/comment/list',
  '/api/common/webViewCount',
  '/api/article/needPwd',
  '/api/user/veirfySecureKey'
]
const customHandle401 = async (
  ctx: ParameterizedContext<DefaultState>,
  next: () => Promise<void>
) => {
  const user = ctx.state.user
  // 抽出来哪些接口不需要用户数据
  if (!user) {
    if (
      paths.some((path) => {
        const { url } = ctx.request
        if (typeof path === 'string') return toLower(path) === toLower(url)
        return path.test(url)
      })
    ) {
      await next()
    } else {
      response.success(ctx, null, '身份凭证无效, 请重新登陆', 401)
    }
  } else {
    await next()
  }
}
export default customHandle401
