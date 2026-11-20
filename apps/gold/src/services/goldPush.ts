import prisma from '../models'
import { logger } from '../logger'

export const PRICE_ALERT_COOLDOWN_MS = 10 * 60_000

export type PriceAlertQuoteUnit = 'usdOz' | 'cnyG';

export function priceInBand(
  price: number,
  target: number,
  tolerancePct: number
): boolean {
  const eps = (target * tolerancePct) / 100
  return price >= target - eps && price <= target + eps
}

function resolveQuoteUnit(u?: string): PriceAlertQuoteUnit {
  return u === 'usdOz' ? 'usdOz' : 'cnyG'
}

type ExpoPushTicket = {
  status: 'ok' | 'error';
  details?: { error?: string };
};

export async function sendExpoPush(
  token: string,
  title: string,
  body: string,
  data?: Record<string, unknown>
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
        channelId: 'price-alerts',
        data: data ?? {}
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
  quoteUnit?: PriceAlertQuoteUnit;
  targetCnyG?: number;
  targetUsdOz?: number;
  tolerancePct: number;
  enabled: boolean;
  removeAfterTrigger?: boolean;
};

function normalizeSyncRow(r: AlertSyncRow): {
  quoteUnit: PriceAlertQuoteUnit;
  targetCnyG: number | null;
  targetUsdOz: number | null;
  label: string;
} | null {
  const quoteUnit = resolveQuoteUnit(r.quoteUnit)
  if (quoteUnit === 'usdOz') {
    const oz = Math.round(Number(r.targetUsdOz))
    if (!(oz > 0)) return null
    const label = r.label.slice(0, 128) || `触及 $${oz}/oz`
    return { quoteUnit, targetCnyG: null, targetUsdOz: oz, label }
  }
  const target = Math.round(Number(r.targetCnyG) * 100) / 100
  if (!(target > 0)) return null
  const label = r.label.slice(0, 128) || `触及 ${target} 元/克`
  return { quoteUnit: 'cnyG', targetCnyG: target, targetUsdOz: null, label }
}

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
    const norm = normalizeSyncRow(r)
    if (!norm) continue
    const tol = Math.min(5, Math.max(0.01, r.tolerancePct))
    const removeAfterTrigger = r.removeAfterTrigger !== false
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
        label: norm.label,
        quoteUnit: norm.quoteUnit,
        targetCnyG: norm.targetCnyG,
        targetUsdOz: norm.targetUsdOz,
        tolerancePct: tol,
        enabled: r.enabled,
        removeAfterTrigger
      },
      update: {
        label: norm.label,
        quoteUnit: norm.quoteUnit,
        targetCnyG: norm.targetCnyG,
        targetUsdOz: norm.targetUsdOz,
        tolerancePct: tol,
        enabled: r.enabled,
        removeAfterTrigger
      }
    })
  }
}

export type SpotForAlert = {
  cnyG: number | null;
  usdOz: number | null;
};

function alertTriggered(
  alert: {
    quoteUnit: string;
    targetCnyG: number | null;
    targetUsdOz: number | null;
    tolerancePct: number;
  },
  spot: SpotForAlert
): boolean {
  const unit = resolveQuoteUnit(alert.quoteUnit)
  if (unit === 'usdOz') {
    const t = alert.targetUsdOz
    const p = spot.usdOz
    if (t == null || !(t > 0) || p == null || !(p > 0)) return false
    return priceInBand(p, t, alert.tolerancePct)
  }
  const t = alert.targetCnyG
  const p = spot.cnyG
  if (t == null || !(t > 0) || p == null || !(p > 0)) return false
  return priceInBand(p, t, alert.tolerancePct)
}

function alertPushBody(
  alert: {
    label: string;
    quoteUnit: string;
  },
  spot: SpotForAlert
): string {
  const unit = resolveQuoteUnit(alert.quoteUnit)
  if (unit === 'usdOz' && spot.usdOz != null) {
    return `${alert.label} · 现价约 $${spot.usdOz.toFixed(1)}/oz`
  }
  if (spot.cnyG != null) {
    return `${alert.label} · 现价约 ${spot.cnyG.toFixed(2)} 元/克`
  }
  return alert.label
}

export async function evaluatePriceAlerts(
  spot: SpotForAlert,
  now = Date.now()
) {
  if (
    (spot.cnyG == null || !(spot.cnyG > 0)) &&
    (spot.usdOz == null || !(spot.usdOz > 0))
  ) {
    return
  }

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

    if (!alertTriggered(alert, spot)) continue

    const title = 'Alke · 金价提醒'
    const body = alertPushBody(alert, spot)
    const ok = await sendExpoPush(push.expoPushToken, title, body, {
      type: 'price_alert',
      clientAlertId: alert.clientAlertId,
      removeAfterTrigger: alert.removeAfterTrigger
    })
    if (!ok) continue

    if (alert.removeAfterTrigger) {
      await prisma.goldPriceAlert.delete({ where: { id: alert.id } })
    } else {
      await prisma.goldPriceAlert.update({
        where: { id: alert.id },
        data: { lastTriggeredAt: BigInt(now) }
      })
    }
  }
}
