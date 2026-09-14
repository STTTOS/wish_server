import type { Next, Context } from 'koa'

import response from '../utils/response'
import { HTTP_STATUS } from '../constants/httpStatus'
import {
  isApiToken,
  type AuthUser,
  verifyUserToken
} from '../services/authToken'

declare module 'koa' {
  interface DefaultState {
    user?: AuthUser | null
    isAdmin?: boolean
  }
}

function extractToken(ctx: Context): string {
  const header = ctx.get('authorization') || ''
  if (header.toLowerCase().startsWith('bearer ')) {
    return header.slice(7).trim()
  }
  return (ctx.get('x-roadsign-token') || '').trim()
}

function isPublicPath(ctx: Context): boolean {
  const { path, method } = ctx
  if (path === '/api/health' || path === '/health') return true
  if (path === '/api/auth/login' && method === 'POST') return true
  if (path === '/api/auth/me' && method === 'GET') return true
  if (path === '/api/auth/logout' && method === 'POST') return true
  if (method !== 'GET') return false
  return (
    path === '/api/roadsign/list' ||
    path === '/api/roadsign/detail' ||
    path === '/api/road/list' ||
    path === '/api/common/static_map'
  )
}

/**
 * 匿名可读列表/详情/静态图；写操作与上传需管理员 JWT 或 ROADSIGN_API_TOKEN。
 */
export async function requireAuth(ctx: Context, next: Next) {
  const token = extractToken(ctx)
  let user: AuthUser | null = null
  let isAdmin = false

  if (token) {
    if (isApiToken(token)) {
      isAdmin = true
      user = { username: 'api-token', role: 'admin' }
    } else {
      user = verifyUserToken(token)
      isAdmin = Boolean(user)
    }
  }

  ctx.state.user = user
  ctx.state.isAdmin = isAdmin

  if (isPublicPath(ctx)) {
    await next()
    return
  }

  if (!isAdmin) {
    response.error(ctx, HTTP_STATUS.UNAUTHORIZED, '需要管理员登录')
    return
  }

  await next()
}
