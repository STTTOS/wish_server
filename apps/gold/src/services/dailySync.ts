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
  source: string;
};

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
 * currency-api 历史日线（XAU/USD 收盘近似；无数据日跳过）。
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
        const urls = [
          `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${date}/v1/currencies/xau.json`,
          `https://${date}.currency-api.pages.dev/v1/currencies/xau.json`
        ]
        for (const url of urls) {
          try {
            const data = (await fetchJson(url)) as { xau?: { usd?: number } }
            const usd = Number(data?.xau?.usd)
            if (!usd || Number.isNaN(usd)) continue
            return {
              date,
              ts: dateKeyToTs(date),
              open: usd,
              high: usd,
              low: usd,
              close: usd,
              source: 'currency-api-xau'
            } satisfies DailyBarRow
          } catch {
            /* try next mirror */
          }
        }
        return null
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
  count: number;
  from: string | null;
  to: string | null;
  message: string;
};

async function upsertBars(bars: DailyBarRow[]): Promise<number> {
  let n = 0
  for (const b of bars) {
    await prisma.dailyBar.upsert({
      where: { date: b.date },
      create: {
        date: b.date,
        ts: BigInt(b.ts),
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
        source: b.source
      },
      update: {
        ts: BigInt(b.ts),
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
        source: b.source
      }
    })
    n += 1
  }
  return n
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
 */
export async function syncDailyHistory(): Promise<DailySyncResult> {
  const before = await meta()
  const today = localDateKey()
  const needBootstrap = before.count < 400

  if (needBootstrap) {
    logger.info('daily bootstrap start', `lookback=${dailyLookbackDays}`)
    const bars = await fetchCurrencyApiDailyGold(dailyLookbackDays, 200)
    const upserted = await upsertBars(bars)
    const after = await meta()
    return {
      ok: true,
      mode: 'bootstrap',
      upserted,
      count: after.count,
      from: after.from,
      to: after.to,
      message: `已全量回填日线 ${upserted} 根（${after.from} → ${after.to}）`
    }
  }

  const to = before.to
  if (!to) {
    return {
      ok: false,
      mode: 'skip',
      upserted: 0,
      count: 0,
      from: null,
      to: null,
      message: '日线为空且 bootstrap 未执行'
    }
  }

  const gapDays = Math.max(
    0,
    Math.round((dateKeyToTs(today) - dateKeyToTs(to)) / 86_400_000)
  )
  if (gapDays <= 0) {
    return {
      ok: true,
      mode: 'skip',
      upserted: 0,
      count: before.count,
      from: before.from,
      to: before.to,
      message: '日线已最新'
    }
  }

  const days = Math.min(dailyLookbackDays, gapDays + 3)
  const bars = await fetchCurrencyApiDailyGold(days, 0)
  const fresh = bars.filter((b) => b.date > to)
  const upserted = await upsertBars(fresh)
  const after = await meta()
  return {
    ok: true,
    mode: 'incremental',
    upserted,
    count: after.count,
    from: after.from,
    to: after.to,
    message: `增量日线 ${upserted} 根（缺口约 ${gapDays} 天）`
  }
}

/** 用现货 tick 滚动更新当日 OHLC */
export async function rollTodayFromSpot(usdOz: number, source: string) {
  if (!(usdOz > 0)) return
  const date = localDateKey()
  const ts = dateKeyToTs(date)
  const existing = await prisma.dailyBar.findUnique({ where: { date } })
  if (!existing) {
    await prisma.dailyBar.create({
      data: {
        date,
        ts: BigInt(ts),
        open: usdOz,
        high: usdOz,
        low: usdOz,
        close: usdOz,
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
      source: `tick:${source}`
    }
  })
}

export { localDateKey }
