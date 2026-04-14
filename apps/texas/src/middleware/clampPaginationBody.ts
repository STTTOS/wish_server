import type { Middleware } from 'koa'

/**
 * 将 `ctx.request.body` 中的 `pageSize` 钳制到不超过 `maxPageSize`。
 * 挂在**具体路由**上即可，无需全局启用；其它列表接口若要防护可复用同一工厂。
 */
export function clampPaginationBody(options: {
  maxPageSize: number
}): Middleware {
  const { maxPageSize } = options
  return async (ctx, next) => {
    const body = ctx.request.body as Record<string, unknown> | undefined
    if (body && typeof body === 'object' && 'pageSize' in body) {
      const n = Number(body.pageSize)
      if (Number.isFinite(n) && n > maxPageSize) {
        body.pageSize = maxPageSize
      }
    }
    await next()
  }
}
