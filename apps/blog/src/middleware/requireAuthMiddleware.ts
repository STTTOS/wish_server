import { toLower } from 'ramda'
import { ParameterizedContext } from 'koa'

import { user } from '../models'
import response from '../utils/response'
import { apiNeededToAuth } from '../config'
import { DefaultState } from '../router/instance'

/** 提前拒绝时须排空请求体，否则大文件 multipart 会导致 ERR_CONNECTION_RESET */
const drainRequestBody = (ctx: ParameterizedContext<DefaultState>) =>
  new Promise<void>((resolve) => {
    const { req } = ctx
    if (req.readableEnded) {
      resolve()
      return
    }
    req.resume()
    req.on('end', () => resolve())
    req.on('error', () => resolve())
  })

const requireAuthMiddleware = async (
  ctx: ParameterizedContext<DefaultState>,
  next: () => Promise<void>
) => {
  const needsAdmin = apiNeededToAuth.some(
    (url) => toLower(url) === toLower(ctx.path)
  )

  if (!needsAdmin) {
    await next()
    return
  }

  const userId = ctx.state.user?.id
  const data = await user.findUnique({ where: { id: userId } })
  if (data?.role !== 'admin') {
    await drainRequestBody(ctx)
    response.success(ctx, null, '无操作权限', 403)
    return
  }

  await next()
}
export default requireAuthMiddleware
