import jwt from 'jsonwebtoken'

import {
  jwtSecret,
  adminPassword,
  adminUsername,
  roadsignApiToken
} from '../config'
import {
  matchAdminSession,
  revokeAdminSession,
  rotateAdminSession
} from './adminSession'

export type AuthUser = {
  username: string
  role: 'admin'
}

type AdminJwtPayload = {
  username?: string
  role?: string
  sessionId?: string
}

export type UserTokenCheck =
  | { ok: true; user: AuthUser }
  | { ok: false; reason: 'invalid' | 'kicked' }

const TOKEN_TTL = '7d'

export async function signAdminToken(username: string): Promise<string> {
  const sessionId = await rotateAdminSession(username)
  return jwt.sign({ username, role: 'admin', sessionId }, jwtSecret, {
    expiresIn: TOKEN_TTL
  })
}

export async function checkUserToken(token: string): Promise<UserTokenCheck> {
  try {
    const payload = jwt.verify(token, jwtSecret) as AdminJwtPayload
    if (payload.role !== 'admin' || !payload.username || !payload.sessionId) {
      return { ok: false, reason: 'invalid' }
    }
    if (!(await matchAdminSession(payload.username, payload.sessionId))) {
      return { ok: false, reason: 'kicked' }
    }
    return { ok: true, user: { username: payload.username, role: 'admin' } }
  } catch {
    return { ok: false, reason: 'invalid' }
  }
}

export async function revokeUserToken(token: string): Promise<void> {
  try {
    const payload = jwt.verify(token, jwtSecret) as AdminJwtPayload
    if (payload.username && payload.sessionId) {
      await revokeAdminSession(payload.username, payload.sessionId)
    }
  } catch {
    /* 过期或伪造 token：无需处理 */
  }
}

/** 静态 API Token（脚本/运维）视为管理员，不受单端登录约束 */
export function isApiToken(token: string): boolean {
  return Boolean(roadsignApiToken) && token === roadsignApiToken
}

export function validateAdminCredentials(
  username: unknown,
  password: unknown
): boolean {
  if (typeof username !== 'string' || typeof password !== 'string') return false
  return username.trim() === adminUsername && password === adminPassword
}
