import { Context } from 'koa'

import { logger } from '../logger'
import { readClientVersionFromRequest } from '../utils/readClientVersion'

const loggerMiddleware = async (ctx: Context, next: () => Promise<void>) => {
  const { url } = ctx.request
  const ip = ctx.headers['x-real-ip'] || ctx.request.ip

  // 记录开始时间
  const start = Date.now()
  await next()

  // 计算响应时间
  const ms = Date.now() - start
  const version = readClientVersionFromRequest(ctx) ?? '-'
  logger.info(
    `ip: ${ip}, version: ${version}, request for ${url}, body: ${JSON.stringify(
      ctx.request.body || {}
    )}; 耗时${ms}ms`
  )
}
export default loggerMiddleware
