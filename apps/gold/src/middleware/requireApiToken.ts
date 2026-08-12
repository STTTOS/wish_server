import type { Context, Next } from 'koa'

import { goldApiToken } from '../config'
import { HTTP_STATUS } from '../constants/httpStatus'
import response from '../utils/response'

function extractToken(ctx: Context): string {
  const header = ctx.get('authorization') || ''
  if (header.toLowerCase().startsWith('bearer ')) {
    return header.slice(7).trim()
  }
  return (ctx.get('x-gold-token') || '').trim()
}

/**
 * 若配置了 GOLD_API_TOKEN，则除 health 外均需鉴权。
 */
export async function requireApiToken(ctx: Context, next: Next) {
  if (!goldApiToken) {
    await next()
    return
  }
  if (ctx.path === '/api/health' || ctx.path === '/health') {
    await next()
    return
  }
  const token = extractToken(ctx)
  if (token !== goldApiToken) {
    response.error(ctx, HTTP_STATUS.UNAUTHORIZED, '无效或缺失 API Token')
    return
  }
  await next()
}
