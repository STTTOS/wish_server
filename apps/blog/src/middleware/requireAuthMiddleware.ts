import { Context } from 'koa'
import { toLower } from 'ramda'

import response from '../utils/response'
import { apiNeededToAuth } from '../config'

const requireAuthMiddleware = async (
  ctx: Context,
  next: () => Promise<void>
) => {
  if (
    apiNeededToAuth.some((url) => toLower(url) === toLower(ctx.request.url))
  ) {
    const {
      userInfo: { tokenStatus, data }
    } = ctx
    const [code, message] = (() => {
      if (tokenStatus === 'expire') return [401, '身份凭证过期, 请重新登陆']
      if (tokenStatus === 'invalid') return [401, '身份凭证无效, 请重新登录']
      if (data?.role !== 'admin') return [403, '哦豁, 莫得访问权限']

      return [200, '成功']
    })()
    if (code === 200) {
      await next()
    } else {
      response.error(ctx, code, message)
    }
  } else {
    await next()
  }
}
export default requireAuthMiddleware
