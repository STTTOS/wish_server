import type { Context, Next } from 'koa'

import { goldApiToken } from '../config'
import { HTTP_STATUS } from '../constants/httpStatus'
import { findValidSession } from '../services/goldAuth'
import response from '../utils/response'

function extractToken(ctx: Context): string {
  const header = ctx.get('authorization') || ''
  if (header.toLowerCase().startsWith('bearer ')) {
    return header.slice(7).trim()
  }
  return (ctx.get('x-gold-token') || '').trim()
}

function isPublicPath(ctx: Context): boolean {
  if (ctx.path === '/api/health' || ctx.path === '/health') return true
  if (ctx.method === 'POST' && ctx.path === '/api/auth/login') return true
  return false
}

/**
 * 金价 API：优先校验账号会话 Bearer；未启用用户表时仍可回退 GOLD_API_TOKEN（运维脚本）。
 */
export async function requireGoldAuth(ctx: Context, next: Next) {
  if (isPublicPath(ctx)) {
    await next()
    return
  }

  const token = extractToken(ctx)
  if (!token) {
    response.error(
      ctx,
      HTTP_STATUS.UNAUTHORIZED,
      '无效或缺失访问凭证',
      null,
      'UNAUTHORIZED'
    )
    return
  }

  const session = await findValidSession(token)
  if (session) {
    ctx.state.goldUser = session.user
    ctx.state.goldSession = session
    await next()
    return
  }

  if (goldApiToken && token === goldApiToken) {
    await next()
    return
  }

  response.error(
    ctx,
    HTTP_STATUS.UNAUTHORIZED,
    '无效或缺失访问凭证',
    null,
    'UNAUTHORIZED'
  )
}
