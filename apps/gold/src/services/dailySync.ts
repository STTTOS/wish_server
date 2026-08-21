import { dailyLookbackDays } from '../config'
import { logger } from '../logger'
import prisma from '../models'

export type DailyBarRow = {
  date: string;
  ts: number;
  open: number;
  high: number;
  low: number;
  close: number;
  /** 当日收盘 USD/CNY；缺则 null */
  usdCnyClose: number | null;
  source: string;
};

/** tick 滚出来的日线（含日终冻结）不可被 currency-api 覆盖 */
export const TICK_FINAL_SOURCE = 'tick:final'

function toDateKeyUTC(tsMs: number): string {
  const d = new Date(tsMs)
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function localDateKey(d = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function shiftDateKey(dateKey: string, deltaDays: number): string {
  const [y, m, d] = dateKey.split('-').map(Number)
  const dt = new Date(Date.UTC(y!, m! - 1, d))
  dt.setUTCDate(dt.getUTCDate() + deltaDays)
  return toDateKeyUTC(dt.getTime())
}

function dateKeyToTs(dateKey: string): number {
  const [y, m, d] = dateKey.split('-').map(Number)
  return Date.UTC(y!, m! - 1, d!)
}

/** 服务器本地日历日 [00:00, 次日 00:00) → epoch ms */
function localDateKeyBoundsMs(dateKey: string): {
  from: number;
  toExcl: number;
} {
  const [y, m, d] = dateKey.split('-').map(Number)
  const from = new Date(y!, m! - 1, d!, 0, 0, 0, 0).getTime()
  return { from, toExcl: from + 86_400_000 }
}

function isTickSourced(source: string): boolean {
  return source === TICK_FINAL_SOURCE || source.startsWith('tick:')
}

function isCurrencyApiSource(source: string): boolean {
  return source.startsWith('currency-api')
}

function asPositiveFx(n: unknown): number | null {
  const v = typeof n === 'number' ? n : Number(n)
  return Number.isFinite(v) && v > 0 ? Math.round(v * 10_000) / 10_000 : null
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'wishufree-gold-server/1.0',
      Accept: 'application/json'
    },
    signal: AbortSignal.timeout(20_000)
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

/**
 * 本地日最后一条有效 Tick.usdCny（与日线 close 对齐的收盘汇率）。
 */
export async function closeFxFromTicks(
  dateKey: string
): Promise<number | null> {
  const { from, toExcl } = localDateKeyBoundsMs(dateKey)
  const row = await prisma.tick.findFirst({
    where: {
      ts: { gte: BigInt(from), lt: BigInt(toExcl) },
      usdCny: { not: null }
    },
    orderBy: { ts: 'desc' },
    select: { usdCny: true }
  })
  return asPositiveFx(row?.usdCny)
}

/** currency-api 同日 USD→CNY 快照 */
export async function fetchCurrencyApiUsdCny(
  date: string
): Promise<number | null> {
  const urls = [
    `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${date}/v1/currencies/usd.json`,
    `https://${date}.currency-api.pages.dev/v1/currencies/usd.json`
  ]
  for (const url of urls) {
    try {
      const data = (await fetchJson(url)) as { usd?: { cny?: number } }
      const rate = asPositiveFx(data?.usd?.cny)
      if (rate != null) return rate
    } catch {
      /* try next mirror */
    }
  }
  return null
}

/**
 * currency-api 历史日线（XAU/USD 收盘近似）+ 同日 USD/CNY。
 */
export async function fetchCurrencyApiDailyGold(
  days = dailyLookbackDays,
  minBars = 0
): Promise<DailyBarRow[]> {
  const end = localDateKey()
  const keys: string[] = []
  for (let i = days; i >= 0; i--) {
    keys.push(shiftDateKey(end, -i))
  }

  const bars: DailyBarRow[] = []
  const concurrency = 12
  for (let i = 0; i < keys.length; i += concurrency) {
    const chunk = keys.slice(i, i + concurrency)
    const results = await Promise.all(
      chunk.map(async (date) => {
        const goldUrls = [
          `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${date}/v1/currencies/xau.json`,
          `https://${date}.currency-api.pages.dev/v1/currencies/xau.json`
        ]
        let usd: number | null = null
        for (const url of goldUrls) {
          try {
            const data = (await fetchJson(url)) as { xau?: { usd?: number } }
            const v = Number(data?.xau?.usd)
            if (v > 0 && Number.isFinite(v)) {
              usd = v
              break
            }
          } catch {
            /* try next mirror */
          }
        }
        if (usd == null) return null
        const usdCnyClose = await fetchCurrencyApiUsdCny(date)
        return {
          date,
          ts: dateKeyToTs(date),
          open: usd,
          high: usd,
          low: usd,
          close: usd,
          usdCnyClose,
          source: 'currency-api-xau'
        } satisfies DailyBarRow
      })
    )
    for (const row of results) {
      if (row) bars.push(row)
    }
  }

  if (minBars > 0 && bars.length < minBars) {
    throw new Error(
      `currency-api 日线不足（仅 ${bars.length} 根，需要 ≥${minBars}）`
    )
  }
  return bars
}

export type DailySyncResult = {
  ok: boolean;
  mode: 'bootstrap' | 'incremental' | 'skip';
  upserted: number;
  skippedProtected: number;
  count: number;
  from: string | null;
  to: string | null;
  message: string;
  fxBackfilled?: number;
};

/**
 * 将已有 tick 日线标为日终冻结，并补齐当日收盘汇率。
 */
export async function freezeDailyBarIfTick(dateKey: string): Promise<boolean> {
  const row = await prisma.dailyBar.findUnique({ where: { date: dateKey } })
  if (!row) return false
  if (row.source === TICK_FINAL_SOURCE) {
    if (row.usdCnyClose == null || !(row.usdCnyClose > 0)) {
      const fx = await closeFxFromTicks(dateKey)
      if (fx != null) {
        await prisma.dailyBar.update({
          where: { date: dateKey },
          data: { usdCnyClose: fx }
        })
      }
    }
    return false
  }
  if (!isTickSourced(row.source)) return false
  const fx =
    row.usdCnyClose != null && row.usdCnyClose > 0
      ? row.usdCnyClose
      : await closeFxFromTicks(dateKey)
  await prisma.dailyBar.update({
    where: { date: dateKey },
    data: {
      source: TICK_FINAL_SOURCE,
      ...(fx != null ? { usdCnyClose: fx } : {})
    }
  })
  logger.info(
    'daily bar frozen',
    dateKey,
    fx != null ? `fx=${fx}` : 'fx=missing'
  )
  return true
}

/** 冻结「昨天」（相对本地日历日） */
export async function freezeYesterdayDailyBar(
  now = new Date()
): Promise<boolean> {
  const yesterday = shiftDateKey(localDateKey(now), -1)
  return freezeDailyBarIfTick(yesterday)
}

/**
 * 回填缺 usdCnyClose 的日线：tick 日用 Tick；currency-api 日用同日 usd.json。
 */
export async function backfillDailyUsdCnyClose(opts?: {
  limit?: number;
}): Promise<{ updated: number; scanned: number }> {
  const limit = Math.max(1, opts?.limit ?? 800)
  const rows = await prisma.dailyBar.findMany({
    where: { OR: [{ usdCnyClose: null }, { usdCnyClose: { lte: 0 } }] },
    orderBy: { date: 'desc' },
    take: limit
  })
  let updated = 0
  const concurrency = 8
  for (let i = 0; i < rows.length; i += concurrency) {
    const chunk = rows.slice(i, i + concurrency)
    await Promise.all(
      chunk.map(async (row) => {
        let fx: number | null = null
        if (isTickSourced(row.source)) {
          fx = await closeFxFromTicks(row.date)
        } else if (isCurrencyApiSource(row.source)) {
          fx = await fetchCurrencyApiUsdCny(row.date)
        }
        if (fx == null) return
        await prisma.dailyBar.update({
          where: { date: row.date },
          data: { usdCnyClose: fx }
        })
        updated += 1
      })
    )
  }
  if (updated > 0) {
    logger.info(
      'daily usdCnyClose backfill',
      `updated=${updated}/${rows.length}`
    )
  }
  return { updated, scanned: rows.length }
}

/**
 * currency-api / 历史 upsert：不覆盖 tick / tick:final；也不用 currency-api 写「今天」。
 */
async function upsertBars(bars: DailyBarRow[]): Promise<{
  upserted: number;
  skippedProtected: number;
}> {
  const today = localDateKey()
  let upserted = 0
  let skippedProtected = 0
  for (const b of bars) {
    if (isCurrencyApiSource(b.source) && b.date >= today) {
      skippedProtected += 1
      continue
    }
    const existing = await prisma.dailyBar.findUnique({
      where: { date: b.date }
    })
    if (existing && isTickSourced(existing.source)) {
      skippedProtected += 1
      continue
    }
    const fx =
      b.usdCnyClose != null && b.usdCnyClose > 0 ? b.usdCnyClose : null
    await prisma.dailyBar.upsert({
      where: { date: b.date },
      create: {
        date: b.date,
        ts: BigInt(b.ts),
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
        usdCnyClose: fx,
        source: b.source
      },
      update: {
        ts: BigInt(b.ts),
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
        source: b.source,
        ...(fx != null ? { usdCnyClose: fx } : {})
      }
    })
    upserted += 1
  }
  return { upserted, skippedProtected }
}

async function meta() {
  const count = await prisma.dailyBar.count()
  const first = await prisma.dailyBar.findFirst({ orderBy: { date: 'asc' } })
  const last = await prisma.dailyBar.findFirst({ orderBy: { date: 'desc' } })
  return {
    count,
    from: first?.date ?? null,
    to: last?.date ?? null
  }
}

/**
 * 启动/定时：本地不足则全量回填近两年；否则增量补最近缺口。
 * 写库前会尝试冻结昨日 tick 日线；结束后回填缺汇率日。
 */
export async function syncDailyHistory(): Promise<DailySyncResult> {
  await freezeYesterdayDailyBar().catch((err) =>
    logger.warn('freeze yesterday failed', err)
  )

  const before = await meta()
  const today = localDateKey()
  const needBootstrap = before.count < 400

  let result: DailySyncResult

  if (needBootstrap) {
    logger.info('daily bootstrap start', `lookback=${dailyLookbackDays}`)
    const bars = await fetchCurrencyApiDailyGold(dailyLookbackDays, 200)
    const { upserted, skippedProtected } = await upsertBars(bars)
    const after = await meta()
    result = {
      ok: true,
      mode: 'bootstrap',
      upserted,
      skippedProtected,
      count: after.count,
      from: after.from,
      to: after.to,
      message: `已全量回填日线 ${upserted} 根（跳过受保护 ${skippedProtected}；${after.from} → ${after.to}）`
    }
  } else {
    const to = before.to
    if (!to) {
      result = {
        ok: false,
        mode: 'skip',
        upserted: 0,
        skippedProtected: 0,
        count: 0,
        from: null,
        to: null,
        message: '日线为空且 bootstrap 未执行'
      }
    } else {
      const gapDays = Math.max(
        0,
        Math.round((dateKeyToTs(today) - dateKeyToTs(to)) / 86_400_000)
      )
      if (gapDays <= 0) {
        result = {
          ok: true,
          mode: 'skip',
          upserted: 0,
          skippedProtected: 0,
          count: before.count,
          from: before.from,
          to: before.to,
          message: '日线已最新'
        }
      } else {
        const days = Math.min(dailyLookbackDays, gapDays + 3)
        const bars = await fetchCurrencyApiDailyGold(days, 0)
        const fresh = bars.filter((b) => b.date > to)
        const { upserted, skippedProtected } = await upsertBars(fresh)
        const after = await meta()
        result = {
          ok: true,
          mode: 'incremental',
          upserted,
          skippedProtected,
          count: after.count,
          from: after.from,
          to: after.to,
          message: `增量日线 ${upserted} 根（缺口约 ${gapDays} 天，跳过受保护 ${skippedProtected}）`
        }
      }
    }
  }

  const bf = await backfillDailyUsdCnyClose({ limit: 800 }).catch((err) => {
    logger.warn('usdCnyClose backfill failed', err)
    return { updated: 0, scanned: 0 }
  })
  result.fxBackfilled = bf.updated
  if (bf.updated > 0) {
    result.message = `${result.message} · 补汇率 ${bf.updated}`
  }
  return result
}

/** 上次用 tick 滚过的本地日，用于跨日时冻结前一日 */
let lastRolledDate: string | null = null

/** 用现货 tick 滚动更新当日 OHLC + 收盘汇率；跨日时冻结昨日 */
export async function rollTodayFromSpot(
  usdOz: number,
  source: string,
  usdCny?: number | null
) {
  if (!(usdOz > 0)) return
  const date = localDateKey()
  const ts = dateKeyToTs(date)
  const fx = asPositiveFx(usdCny)

  if (lastRolledDate && date !== lastRolledDate) {
    await freezeDailyBarIfTick(lastRolledDate).catch((err) =>
      logger.warn('freeze on day roll failed', err)
    )
  }
  lastRolledDate = date

  const existing = await prisma.dailyBar.findUnique({ where: { date } })
  if (existing?.source === TICK_FINAL_SOURCE) {
    // 不应给「今天」打 final；若误标则不再改 OHLC
    return
  }
  if (!existing) {
    await prisma.dailyBar.create({
      data: {
        date,
        ts: BigInt(ts),
        open: usdOz,
        high: usdOz,
        low: usdOz,
        close: usdOz,
        usdCnyClose: fx,
        source: `tick:${source}`
      }
    })
    return
  }
  await prisma.dailyBar.update({
    where: { date },
    data: {
      high: Math.max(existing.high, usdOz),
      low: Math.min(existing.low, usdOz),
      close: usdOz,
      source: `tick:${source}`,
      ...(fx != null ? { usdCnyClose: fx } : {})
    }
  })
}

export { localDateKey, shiftDateKey }
