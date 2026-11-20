import { randomBytes } from 'crypto'

import prisma from '../models'
import { verifyPassword } from '../utils/password'
import { revokeOtherUsersPushOnDevice } from './goldPush'

export type GoldPlatform = 'desktop' | 'mobile';

const SESSION_TTL_MS = 30 * 24 * 60 * 60_000

function newAccessToken(): string {
  return randomBytes(32).toString('hex')
}

function expiresAtMs(): bigint {
  return BigInt(Date.now() + SESSION_TTL_MS)
}

export function normalizePlatform(raw: string): GoldPlatform | null {
  const p = raw.trim().toLowerCase()
  if (p === 'desktop' || p === 'mobile') return p
  return null
}

export async function loginGoldUser(opts: {
  username: string;
  password: string;
  platform: GoldPlatform;
  deviceId: string;
}) {
  const username = opts.username.trim()
  const deviceId = opts.deviceId.trim()
  if (!username || !opts.password || !deviceId) {
    return { kind: 'invalid' as const }
  }

  const user = await prisma.goldUser.findUnique({ where: { username } })
  if (!user || !verifyPassword(opts.password, user.passwordHash)) {
    return { kind: 'invalid' as const }
  }

  const accessToken = newAccessToken()
  const expiresAt = expiresAtMs()

  await revokeOtherUsersPushOnDevice(user.id, deviceId)

  const session = await prisma.goldAuthSession.upsert({
    where: {
      userId_platform: { userId: user.id, platform: opts.platform }
    },
    create: {
      userId: user.id,
      platform: opts.platform,
      deviceId,
      accessToken,
      expiresAt
    },
    update: {
      deviceId,
      accessToken,
      expiresAt
    }
  })

  return {
    kind: 'ok' as const,
    data: {
      accessToken: session.accessToken,
      expiresAt: Number(session.expiresAt),
      username: user.username,
      platform: opts.platform,
      deviceId: session.deviceId
    }
  }
}

export async function logoutGoldSession(accessToken: string, deviceId: string) {
  const token = accessToken.trim()
  const dev = deviceId.trim()
  if (!token || !dev) return
  const row = await prisma.goldAuthSession.findUnique({
    where: { accessToken: token }
  })
  if (!row || row.deviceId !== dev) return
  await prisma.goldAuthSession.delete({ where: { id: row.id } })
}

export async function findValidSession(accessToken: string) {
  const token = accessToken.trim()
  if (!token) return null
  const row = await prisma.goldAuthSession.findUnique({
    where: { accessToken: token },
    include: { user: true }
  })
  if (!row) return null
  if (Number(row.expiresAt) < Date.now()) {
    await prisma.goldAuthSession
      .delete({ where: { id: row.id } })
      .catch(() => undefined)
    return null
  }
  return row
}
