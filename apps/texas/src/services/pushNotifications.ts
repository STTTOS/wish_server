import prisma from '../models'
import { logger } from '../logger'

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send'
const EXPO_TOKEN_RE = /^ExponentPushToken\[[\w-]+\]$/

export type PushPlatform = 'ios' | 'android' | 'unknown'

export function isValidExpoPushToken(token: string): boolean {
  return EXPO_TOKEN_RE.test(token.trim())
}

export function normalizePushPlatform(raw: unknown): PushPlatform {
  if (raw === 'ios' || raw === 'android') return raw
  return 'unknown'
}

/** 绑定/换绑当前用户的 Expo Push Token（token 全局唯一） */
export async function upsertUserPushToken(params: {
  userId: number
  token: string
  platform: PushPlatform
}): Promise<void> {
  const token = params.token.trim()
  await prisma.userPushToken.upsert({
    where: { token },
    create: {
      userId: params.userId,
      token,
      platform: params.platform
    },
    update: {
      userId: params.userId,
      platform: params.platform
    }
  })
}

export async function removeUserPushToken(params: {
  userId: number
  token: string
}): Promise<void> {
  const token = params.token.trim()
  await prisma.userPushToken.deleteMany({
    where: { userId: params.userId, token }
  })
}

type ExpoPushMessage = {
  to: string
  title: string
  body: string
  data?: Record<string, unknown>
  sound?: 'default' | null
  badge?: number
  channelId?: string
}

async function sendExpoPushMessages(
  messages: ExpoPushMessage[]
): Promise<void> {
  if (messages.length === 0) return
  try {
    const res = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(messages)
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      logger.warn(`[push] Expo Push HTTP ${res.status}: ${text.slice(0, 300)}`)
      return
    }
    const json = (await res.json().catch(() => null)) as {
      data?: Array<{ status?: string; message?: string; details?: unknown }>
    } | null
    const rows = json?.data
    if (!Array.isArray(rows)) return
    for (const row of rows) {
      if (row?.status === 'error') {
        logger.warn('[push] Expo ticket error', row)
      }
    }
  } catch (err) {
    logger.error('[push] Expo Push request failed', err)
  }
}

/**
 * 给指定用户所有已注册 iOS 设备发推送。失败只打日志，不抛给业务路径。
 */
export async function notifyUserDevicesSafe(params: {
  userId: number
  title: string
  body: string
  data?: Record<string, unknown>
  badge?: number
}): Promise<void> {
  await notifyUsersDevicesSafe({
    userIds: [params.userId],
    title: params.title,
    body: params.body,
    data: params.data,
    badge: params.badge
  })
}

/** 批量：仅 iOS token；空列表 no-op */
export async function notifyUsersDevicesSafe(params: {
  userIds: number[]
  title: string
  body: string
  data?: Record<string, unknown>
  badge?: number
}): Promise<void> {
  const userIds = [
    ...new Set(params.userIds.filter((id) => Number.isInteger(id) && id > 0))
  ]
  if (userIds.length === 0) return
  try {
    const rows = await prisma.userPushToken.findMany({
      where: { userId: { in: userIds }, platform: 'ios' },
      select: { token: true }
    })
    if (rows.length === 0) return

    const messages: ExpoPushMessage[] = rows.map((r) => ({
      to: r.token,
      title: params.title,
      body: params.body,
      data: params.data,
      sound: 'default',
      badge: params.badge
    }))
    await sendExpoPushMessages(messages)
  } catch (err) {
    logger.error(
      `[push] notifyUsersDevicesSafe failed userIds=${userIds.join(',')}`,
      err
    )
  }
}

/** 新留言：通知墙主（异步，不阻塞 create 响应） */
export function scheduleGuestbookPush(params: {
  wallUserId: number
  authorName: string
  content: string
  messageId: number
}): void {
  const preview =
    params.content.length > 24
      ? `${params.content.slice(0, 24)}…`
      : params.content
  void (async () => {
    let badge: number | undefined
    try {
      const { getGuestbookUnreadCount } = await import('./profileSocial')
      badge = await getGuestbookUnreadCount(params.wallUserId)
    } catch {
      badge = undefined
    }
    await notifyUserDevicesSafe({
      userId: params.wallUserId,
      title: '新留言',
      body: `${params.authorName}：${preview}`,
      data: {
        type: 'guestbook',
        messageId: params.messageId
      },
      badge
    })
  })().catch((err) => {
    logger.error('[push] scheduleGuestbookPush failed', err)
  })
}

/** 房主点开始：通知桌上成员「对局开始了」（异步） */
export function scheduleMatchEnteringPush(params: {
  roomId: number
  userIds: number[]
}): void {
  void notifyUsersDevicesSafe({
    userIds: params.userIds,
    title: '对局开始了',
    body: '房主已开始游戏，快返回牌桌吧',
    data: {
      type: 'match_entering',
      roomId: params.roomId
    }
  }).catch((err) => {
    logger.error('[push] scheduleMatchEnteringPush failed', err)
  })
}

/** 轮到该玩家行动（异步；思考时长通常数十秒，频率可控） */
export function scheduleYourTurnPush(params: {
  userId: number
  roomId: number
  matchId: number
}): void {
  void notifyUserDevicesSafe({
    userId: params.userId,
    title: '轮到你行动了',
    body: '请尽快返回牌桌完成操作',
    data: {
      type: 'your_turn',
      roomId: params.roomId,
      matchId: params.matchId
    }
  }).catch((err) => {
    logger.error('[push] scheduleYourTurnPush failed', err)
  })
}
