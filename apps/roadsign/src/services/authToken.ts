import jwt from 'jsonwebtoken'

import {
  jwtSecret,
  adminPassword,
  adminUsername,
  roadsignApiToken
} from '../config'

export type AuthUser = {
  username: string
  role: 'admin'
}

const TOKEN_TTL = '7d'

export function signAdminToken(username: string): string {
  return jwt.sign({ username, role: 'admin' }, jwtSecret, {
    expiresIn: TOKEN_TTL
  })
}

export function verifyUserToken(token: string): AuthUser | null {
  try {
    const payload = jwt.verify(token, jwtSecret) as {
      username?: string
      role?: string
    }
    if (payload.role !== 'admin' || !payload.username) return null
    return { username: payload.username, role: 'admin' }
  } catch {
    return null
  }
}

/** 静态 API Token（脚本/运维）视为管理员 */
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
