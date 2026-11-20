import prisma from '../models'
import { logger } from '../logger'

export const PRICE_ALERT_COOLDOWN_MS = 10 * 60_000

export function priceInBand(
  price: number,
  target: number,
  tolerancePct: number
): boolean {
  const eps = (target * tolerancePct) / 100
  return price >= target - eps && price <= target + eps
}

type ExpoPushTicket = {
  status: 'ok' | 'error';
  details?: { error?: string };
};

export async function sendExpoPush(
  token: string,
  title: string,
  body: string
): Promise<boolean> {
  try {
    const res = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        to: token,
        sound: 'default',
        title,
        body,
        priority: 'high',
        channelId: 'price-alerts'
      })
    })
    const json = (await res.json()) as { data?: ExpoPushTicket[] }
    const ticket = json.data?.[0]
    if (ticket?.status === 'error') {
      const err = ticket.details?.error ?? 'unknown'
      if (err === 'DeviceNotRegistered') {
        await prisma.goldPushRegistration.deleteMany({
          where: { expoPushToken: token }
        })
      }
      logger.warn('expo push error', err)
      return false
    }
    return true
  } catch (e) {
    logger.warn('expo push failed', e)
    return false
  }
}

/** 同机切换账号：撤销其他用户在此 device 上的推送注册与提醒 */
export async function revokeOtherUsersPushOnDevice(
  userId: bigint,
  deviceId: string
) {
  const sessions = await prisma.goldAuthSession.findMany({
    where: {
      platform: 'mobile',
      deviceId,
      userId: { not: userId }
    },
    select: { id: true }
  })
  if (sessions.length === 0) return
  const ids = sessions.map((s) => s.id)
  await prisma.goldPushRegistration.deleteMany({
    where: { sessionId: { in: ids } }
  })
  await prisma.goldPriceAlert.deleteMany({
    where: { sessionId: { in: ids } }
  })
  await prisma.goldAuthSession.deleteMany({ where: { id: { in: ids } } })
}

export async function upsertPushRegistration(
  session: { id: bigint; userId: bigint; deviceId: string },
  expoPushToken: string
) {
  const token = expoPushToken.trim()
  if (
    !token.startsWith('ExponentPushToken') &&
    !token.startsWith('ExpoPushToken')
  ) {
    throw new Error('无效的 Expo Push Token')
  }

  await revokeOtherUsersPushOnDevice(session.userId, session.deviceId)

  await prisma.goldPushRegistration.deleteMany({
    where: {
      expoPushToken: token,
      NOT: { sessionId: session.id }
    }
  })

  await prisma.goldPushRegistration.upsert({
    where: { sessionId: session.id },
    create: { sessionId: session.id, expoPushToken: token },
    update: { expoPushToken: token }
  })
}

export type AlertSyncRow = {
  clientAlertId: string;
  label: string;
  targetCnyG: number;
  tolerancePct: number;
  enabled: boolean;
};

export async function syncSessionPriceAlerts(
  sessionId: bigint,
  rows: AlertSyncRow[]
) {
  if (rows.length === 0) {
    await prisma.goldPriceAlert.deleteMany({ where: { sessionId } })
    return
  }
  const ids = rows.map((r) => r.clientAlertId).filter(Boolean)
  await prisma.goldPriceAlert.deleteMany({
    where: {
      sessionId,
      clientAlertId: { notIn: ids }
    }
  })

  for (const r of rows) {
    const target = Math.round(r.targetCnyG * 100) / 100
    if (!(target > 0)) continue
    const tol = Math.min(5, Math.max(0.01, r.tolerancePct))
    await prisma.goldPriceAlert.upsert({
      where: {
        sessionId_clientAlertId: {
          sessionId,
          clientAlertId: r.clientAlertId
        }
      },
      create: {
        sessionId,
        clientAlertId: r.clientAlertId,
        label: r.label.slice(0, 128) || `触及 ${target} 元/克`,
        targetCnyG: target,
        tolerancePct: tol,
        enabled: r.enabled
      },
      update: {
        label: r.label.slice(0, 128) || `触及 ${target} 元/克`,
        targetCnyG: target,
        tolerancePct: tol,
        enabled: r.enabled
      }
    })
  }
}

export async function evaluatePriceAlerts(
  cnyG: number | null,
  now = Date.now()
) {
  if (cnyG == null || !(cnyG > 0)) return

  const rows = await prisma.goldPriceAlert.findMany({
    where: { enabled: true },
    include: {
      session: {
        include: { push: true, user: true }
      }
    }
  })

  for (const alert of rows) {
    const push = alert.session.push
    if (!push) continue
    if (Number(alert.session.expiresAt) < now) continue

    if (alert.lastTriggeredAt != null) {
      if (now - Number(alert.lastTriggeredAt) < PRICE_ALERT_COOLDOWN_MS)
        continue
    }

    if (!priceInBand(cnyG, alert.targetCnyG, alert.tolerancePct)) continue

    const title = 'Alke · 金价提醒'
    const body = `${alert.label} · 现价约 ${cnyG.toFixed(2)} 元/克`
    const ok = await sendExpoPush(push.expoPushToken, title, body)
    if (!ok) continue

    await prisma.goldPriceAlert.update({
      where: { id: alert.id },
      data: { lastTriggeredAt: BigInt(now) }
    })
  }
}
