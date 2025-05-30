import { Context } from 'koa'

import { logger } from '../logger'
import response from '@/utils/response'

const loggerMiddleware = async (ctx: Context, next: () => Promise<void>) => {
  try {
    await next()
  } catch (error) {
    response.error(ctx, 500, '系统异常')
    logger.error(error)
  }
}
export default loggerMiddleware
