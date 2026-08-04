import type { Middleware } from 'koa'

import crypto from 'crypto'

export function createTraceIdMiddleware(): Middleware {
  return async (ctx, next) => {
    const traceId = crypto.randomUUID()
    ;(ctx.state as { traceId?: string }).traceId = traceId
    ctx.set('x-trace-id', traceId)
    await next()
  }
}
