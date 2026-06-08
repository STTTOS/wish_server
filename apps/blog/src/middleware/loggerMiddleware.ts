import { Context } from 'koa'

import { logger } from '../logger'

const formatRequestBody = (ctx: Context, contentType: string) => {
  if (contentType.includes('multipart')) return '(multipart)'
  return JSON.stringify(ctx.request.body || {})
}

const loggerMiddleware = async (ctx: Context, next: () => Promise<void>) => {
  const { url, method } = ctx.request
  const ip = ctx.headers['x-real-ip'] || ctx.request.ip
  const contentType = ctx.get('content-type')
  const contentLength = ctx.get('content-length')

  const start = Date.now()
  logger.info(
    `ip: ${ip}, --> ${method} ${url}` +
      (contentType ? `, content-type: ${contentType.split(';')[0]}` : '') +
      (contentLength ? `, content-length: ${contentLength}` : '')
  )

  try {
    await next()
  } finally {
    const ms = Date.now() - start
    logger.info(
      `ip: ${ip}, <-- ${method} ${url}, status: ${
        ctx.status
      }, body: ${formatRequestBody(ctx, contentType)}; 耗时${ms}ms`
    )
  }
}
export default loggerMiddleware
