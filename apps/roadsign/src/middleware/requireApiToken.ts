import type { Next, Context } from 'koa'

import response from '../utils/response'
import { roadsignApiToken } from '../config'
import { HTTP_STATUS } from '../constants/httpStatus'

function extractToken(ctx: Context): string {
  const header = ctx.get('authorization') || ''
  if (header.toLowerCase().startsWith('bearer ')) {
    return header.slice(7).trim()
  }
  return (ctx.get('x-roadsign-token') || '').trim()
}

function isPublicRead(ctx: Context): boolean {
  if (ctx.path === '/api/health' || ctx.path === '/health') return true
  if (ctx.method !== 'GET') return false
  return (
    ctx.path === '/api/roadsign/list' ||
    ctx.path === '/api/roadsign/detail' ||
    ctx.path === '/api/road/list'
  )
}

/**
 * 配置 ROADSIGN_API_TOKEN 后：列表/详情/健康检查可匿名；写操作与上传需鉴权。
 */
export async function requireApiToken(ctx: Context, next: Next) {
  if (!roadsignApiToken) {
    await next()
    return
  }
  if (isPublicRead(ctx)) {
    await next()
    return
  }
  const token = extractToken(ctx)
  if (token !== roadsignApiToken) {
    response.error(ctx, HTTP_STATUS.UNAUTHORIZED, '无效或缺失 API Token')
    return
  }
  await next()
}
