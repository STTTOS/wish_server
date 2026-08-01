import type { Middleware } from 'koa'

import { logger } from '../logger'

export function createRequestLogMiddleware(): Middleware {
  return async (ctx, next) => {
    const { ip, url } = ctx.request
    logger.info(`ip: ${ip}, request for ${url}`)
    await next()
  }
}
