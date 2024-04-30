import { Context } from 'koa'

import { logger } from '../logger'
import response from '../utils/response'

const errorHandlerMiddleware = async (
  ctx: Context,
  next: () => Promise<void>
) => {
  try {
    await next()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    logger.error(err.stack || err.message)
    ctx.status = 500
    response.error(ctx, 500, '遭了, 服务器内部出问题了')
  }
}
export default errorHandlerMiddleware
