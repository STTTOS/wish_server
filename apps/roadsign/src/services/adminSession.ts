import { randomUUID } from 'node:crypto'

import prisma from '../models'

const cache = new Map<string, string>()

export async function rotateAdminSession(username: string): Promise<string> {
  const sessionId = randomUUID()
  await prisma.adminSession.upsert({
    where: { username },
    create: { username, sessionId },
    update: { sessionId }
  })
  cache.set(username, sessionId)
  return sessionId
}

export async function matchAdminSession(
  username: string,
  sessionId: string
): Promise<boolean> {
  if (!sessionId) return false
  const cached = cache.get(username)
  if (cached) return cached === sessionId
  const row = await prisma.adminSession.findUnique({ where: { username } })
  if (!row) return false
  cache.set(username, row.sessionId)
  return row.sessionId === sessionId
}

export async function revokeAdminSession(
  username: string,
  sessionId: string
): Promise<void> {
  await prisma.adminSession.deleteMany({ where: { username, sessionId } })
  if (cache.get(username) === sessionId) cache.delete(username)
}
