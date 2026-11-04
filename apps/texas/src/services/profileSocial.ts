import dayjs from 'dayjs'

import prisma from '../models'

export const PROFILE_HIGHLIGHT_SLOT_COUNT = 6
export const PROFILE_GUESTBOOK_MAX_CHARS = 40
export const PROFILE_GUESTBOOK_DAILY_LIMIT_PER_WALL = 3
export const PROFILE_GUESTBOOK_DEFAULT_LIMIT = 30
export const PROFILE_GUESTBOOK_MAX_LIMIT = 50

export type ProfileHighlightSlot = {
  slotIndex: number
  imageUrl: string | null
  updatedAt: string | null
}

export type ProfileGuestbookItem = {
  id: number
  content: string
  createdAt: string
  author: {
    id: number
    name: string
    avatarUrl: string | null
    avatarKey: string
  }
}

function isValidSlotIndex(slotIndex: number): boolean {
  return (
    Number.isInteger(slotIndex) &&
    slotIndex >= 0 &&
    slotIndex < PROFILE_HIGHLIGHT_SLOT_COUNT
  )
}

export function normalizeGuestbookContent(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const content = raw.trim().replace(/\s+/g, ' ')
  if (!content) return null
  if (Array.from(content).length > PROFILE_GUESTBOOK_MAX_CHARS) return null
  return content
}

export async function listProfileHighlights(
  userId: number
): Promise<ProfileHighlightSlot[]> {
  const rows = await prisma.profileHighlight.findMany({
    where: { userId },
    select: { slotIndex: true, imageUrl: true, updatedAt: true }
  })
  const bySlot = new Map(rows.map((row) => [row.slotIndex, row]))
  return Array.from(
    { length: PROFILE_HIGHLIGHT_SLOT_COUNT },
    (_, slotIndex) => {
      const row = bySlot.get(slotIndex)
      return {
        slotIndex,
        imageUrl: row?.imageUrl ?? null,
        updatedAt: row?.updatedAt ? row.updatedAt.toISOString() : null
      }
    }
  )
}

export async function setProfileHighlight(params: {
  userId: number
  slotIndex: number
  imageUrl: string
}): Promise<ProfileHighlightSlot[] | { error: string }> {
  const { userId, slotIndex, imageUrl } = params
  if (!isValidSlotIndex(slotIndex)) {
    return { error: '槽位无效' }
  }
  const url = imageUrl.trim()
  if (!url || url.length > 512) {
    return { error: '图片地址无效' }
  }
  await prisma.profileHighlight.upsert({
    where: { userId_slotIndex: { userId, slotIndex } },
    create: { userId, slotIndex, imageUrl: url },
    update: { imageUrl: url }
  })
  return listProfileHighlights(userId)
}

export async function clearProfileHighlight(params: {
  userId: number
  slotIndex: number
}): Promise<ProfileHighlightSlot[] | { error: string }> {
  const { userId, slotIndex } = params
  if (!isValidSlotIndex(slotIndex)) {
    return { error: '槽位无效' }
  }
  await prisma.profileHighlight.deleteMany({
    where: { userId, slotIndex }
  })
  return listProfileHighlights(userId)
}

export async function listGuestbookMessages(params: {
  wallUserId: number
  limit?: number
}): Promise<ProfileGuestbookItem[]> {
  const limit = Math.min(
    Math.max(Number(params.limit) || PROFILE_GUESTBOOK_DEFAULT_LIMIT, 1),
    PROFILE_GUESTBOOK_MAX_LIMIT
  )
  const rows = await prisma.profileGuestbookMessage.findMany({
    where: { wallUserId: params.wallUserId },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true,
      content: true,
      createdAt: true,
      author: {
        select: {
          id: true,
          name: true,
          avatarUrl: true,
          avatarKey: true
        }
      }
    }
  })
  return rows.map((row) => ({
    id: row.id,
    content: row.content,
    createdAt: row.createdAt.toISOString(),
    author: row.author
  }))
}

export async function createGuestbookMessage(params: {
  wallUserId: number
  authorUserId: number
  content: string
}): Promise<ProfileGuestbookItem | { error: string; status?: number }> {
  const { wallUserId, authorUserId, content } = params
  if (wallUserId === authorUserId) {
    return { error: '不能给自己留言', status: 400 }
  }
  const wall = await prisma.user.findUnique({
    where: { id: wallUserId },
    select: { id: true }
  })
  if (!wall) {
    return { error: '用户不存在', status: 404 }
  }

  const dayStart = dayjs().startOf('day').toDate()
  const todayCount = await prisma.profileGuestbookMessage.count({
    where: {
      authorUserId,
      wallUserId,
      createdAt: { gte: dayStart }
    }
  })
  if (todayCount >= PROFILE_GUESTBOOK_DAILY_LIMIT_PER_WALL) {
    return {
      error: `今日对该玩家留言已达上限（${PROFILE_GUESTBOOK_DAILY_LIMIT_PER_WALL}条）`,
      status: 400
    }
  }

  const created = await prisma.profileGuestbookMessage.create({
    data: { wallUserId, authorUserId, content },
    select: {
      id: true,
      content: true,
      createdAt: true,
      author: {
        select: {
          id: true,
          name: true,
          avatarUrl: true,
          avatarKey: true
        }
      }
    }
  })
  return {
    id: created.id,
    content: created.content,
    createdAt: created.createdAt.toISOString(),
    author: created.author
  }
}

/** 仅墙主可删 */
export async function deleteGuestbookMessage(params: {
  messageId: number
  wallOwnerId: number
}): Promise<{ ok: true } | { error: string; status?: number }> {
  const row = await prisma.profileGuestbookMessage.findUnique({
    where: { id: params.messageId },
    select: { id: true, wallUserId: true }
  })
  if (!row) {
    return { error: '留言不存在', status: 404 }
  }
  if (row.wallUserId !== params.wallOwnerId) {
    return { error: '无权删除', status: 403 }
  }
  await prisma.profileGuestbookMessage.delete({ where: { id: row.id } })
  return { ok: true }
}
