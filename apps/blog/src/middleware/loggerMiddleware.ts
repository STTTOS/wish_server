import { Context } from 'koa'

import { logger } from '../logger'

const loggerMiddleware = async (ctx: Context, next: () => Promise<void>) => {
  const { url } = ctx.request
  const ip = ctx.headers['x-real-ip'] || ctx.request.ip

  logger.info(`ip: ${ip}, request for ${url}`)
  await next()
}
export default loggerMiddleware
