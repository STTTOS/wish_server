import type { Socket } from 'socket.io'

import { decrypt } from './cryptor'
import { getLoginSession, type LoginScope } from './loginSession'

const LOGIN_SCOPES: LoginScope[] = ['client', 'web']

/**
 * 从 Socket.IO 握手取出登录 token（与 HTTP 共用同一 JWT）。
 * 优先级：handshake.auth.token → query.token → Authorization: Bearer
 */
export function getWsTokenFromHandshake(
  handshake: Socket['handshake']
): string | null {
  const auth = handshake.auth
  if (auth && typeof auth === 'object' && 'token' in auth) {
    const authToken = (auth as { token?: unknown }).token
    if (typeof authToken === 'string' && authToken) return authToken
  }

  const queryToken = handshake.query.token
  if (typeof queryToken === 'string' && queryToken) return queryToken
  if (
    Array.isArray(queryToken) &&
    typeof queryToken[0] === 'string' &&
    queryToken[0]
  ) {
    return queryToken[0]
  }
  // 从header中获取Authorization Bearer token
  const authorizationHeader = handshake.headers.authorization
  if (
    typeof authorizationHeader === 'string' &&
    authorizationHeader.startsWith('Bearer ')
  ) {
    const bearerToken = authorizationHeader.slice(7).trim()
    return bearerToken || null
  }
  return null
}

/**
 * 仅从 handshake.auth 读取 roomId（客户端约定放在 auth 中）。
 */
export function getWsRoomIdFromHandshakeAuth(
  handshake: Socket['handshake']
): number | null {
  const auth = handshake.auth
  if (!auth || typeof auth !== 'object' || !('roomId' in auth)) return null

  const raw = (auth as { roomId?: unknown }).roomId
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
    return Math.trunc(raw)
  }
  if (typeof raw === 'string' && raw.trim()) {
    const roomId = Number(raw.trim())
    if (Number.isFinite(roomId) && roomId > 0) return Math.trunc(roomId)
  }
  return null
}

/**
 * 从 `handshake.auth.gameRoomSinceSeq` 读取「上次已确认的全房 WS 序号」。
 * 重连时传入，服务端在 `message` 中下发 `game-room-replay`；缺省或非法视为 `0`。
 */
export function getWsGameRoomSinceSeqFromHandshake(
  handshake: Socket['handshake']
): number {
  const auth = handshake.auth
  if (!auth || typeof auth !== 'object') return 0
  const raw = (auth as { gameRoomSinceSeq?: unknown }).gameRoomSinceSeq
  if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0) {
    return Math.floor(raw)
  }
  if (typeof raw === 'string' && raw.trim()) {
    const n = Number(raw.trim())
    if (Number.isFinite(n) && n >= 0) return Math.floor(n)
  }
  return 0
}

/** 从 `handshake.auth.gameRoomReplayEpoch` 读取客户端记忆的 replay 世代。 */
export function getWsGameRoomReplayEpochFromHandshake(
  handshake: Socket['handshake']
): string | null {
  const auth = handshake.auth
  if (!auth || typeof auth !== 'object') return null
  const raw = (auth as { gameRoomReplayEpoch?: unknown }).gameRoomReplayEpoch
  if (typeof raw !== 'string') return null
  const normalized = raw.trim()
  return normalized.length > 0 ? normalized : null
}

/**
 * 校验 JWT 且 session 与 Redis/内存中当前登录态一致（单端登录）。
 */
export async function verifyWsLoginToken(
  token: string
): Promise<number | null> {
  let payload: { id: number; sessionId: string }
  try {
    payload = decrypt<{ id: number; sessionId: string }>(token)
  } catch {
    return null
  }
  if (!payload?.id || !payload?.sessionId) return null

  for (const scope of LOGIN_SCOPES) {
    const latest = await getLoginSession(payload.id, scope)
    if (latest?.sessionId === payload.sessionId) return payload.id
  }
  return null
}

export async function resolveWsUserFromHandshake(
  handshake: Socket['handshake']
): Promise<number | null> {
  const token = getWsTokenFromHandshake(handshake)
  if (!token) return null
  return verifyWsLoginToken(token)
}
