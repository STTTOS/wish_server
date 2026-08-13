/**
 * 日终原料质量：覆盖率 / 断档 / tick:final / 与 currency-api 单点偏差。
 * 每天一行落库，供持续分析与迭代信任度体检。
 */
import { pollIntervalMs } from '../config'
import { logger } from '../logger'
import prisma from '../models'
import { TICK_FINAL_SOURCE, localDateKey, shiftDateKey } from './dailySync'

const GAP_MS = 45_000
const DAY_MS = 86_400_000

export type DailyQualityRow = {
  date: string;
  tickCount: number;
  expectedTicks: number;
  coveragePct: number;
  gapCount: number;
  maxGapMs: number;
  firstTickAt: number | null;
  lastTickAt: number | null;
  dailyBarSource: string | null;
  dailyBarFrozen: boolean;
  currencyCloseDiff: number | null;
  currencyCloseUsd: number | null;
  tickCloseUsd: number | null;
  note: string | null;
};

function dateKeyToLocalDayRange(dateKey: string): {
  start: number;
  endExclusive: number;
} {
  const [y, m, d] = dateKey.split('-').map(Number)
  const start = new Date(y!, m! - 1, d!, 0, 0, 0, 0).getTime()
  return { start, endExclusive: start + DAY_MS }
}

async function fetchCurrencyCloseUsd(date: string): Promise<number | null> {
  const urls = [
    `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${date}/v1/currencies/xau.json`,
    `https://${date}.currency-api.pages.dev/v1/currencies/xau.json`
  ]
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'wishufree-gold-server/1.0',
          Accept: 'application/json'
        },
        signal: AbortSignal.timeout(15_000)
      })
      if (!res.ok) continue
      const data = (await res.json()) as { xau?: { usd?: number } }
      const usd = Number(data?.xau?.usd)
      if (usd > 0 && Number.isFinite(usd)) return usd
    } catch {
      /* next mirror */
    }
  }
  return null
}

function toDto(row: {
  date: string;
  tickCount: number;
  expectedTicks: number;
  coveragePct: number;
  gapCount: number;
  maxGapMs: number;
  firstTickAt: bigint | null;
  lastTickAt: bigint | null;
  dailyBarSource: string | null;
  dailyBarFrozen: boolean;
  currencyCloseDiff: number | null;
  currencyCloseUsd: number | null;
  tickCloseUsd: number | null;
  note: string | null;
}): DailyQualityRow {
  return {
    date: row.date,
    tickCount: row.tickCount,
    expectedTicks: row.expectedTicks,
    coveragePct: row.coveragePct,
    gapCount: row.gapCount,
    maxGapMs: row.maxGapMs,
    firstTickAt: row.firstTickAt != null ? Number(row.firstTickAt) : null,
    lastTickAt: row.lastTickAt != null ? Number(row.lastTickAt) : null,
    dailyBarSource: row.dailyBarSource,
    dailyBarFrozen: row.dailyBarFrozen,
    currencyCloseDiff: row.currencyCloseDiff,
    currencyCloseUsd: row.currencyCloseUsd,
    tickCloseUsd: row.tickCloseUsd,
    note: row.note
  }
}

/**
 * 计算并 upsert 某日质量快照。
 */
export async function upsertDailyQuality(
  dateKey: string
): Promise<DailyQualityRow> {
  const { start, endExclusive } = dateKeyToLocalDayRange(dateKey)
  const interval = Math.max(1000, pollIntervalMs)
  const expectedTicks = Math.floor(DAY_MS / interval)

  const ticks = await prisma.tick.findMany({
    where: {
      ts: { gte: BigInt(start), lt: BigInt(endExclusive) }
    },
    orderBy: { ts: 'asc' },
    select: { ts: true, usdOz: true }
  })

  let gapCount = 0
  let maxGapMs = 0
  for (let i = 1; i < ticks.length; i++) {
    const gap = Number(ticks[i]!.ts) - Number(ticks[i - 1]!.ts)
    if (gap >= GAP_MS) {
      gapCount += 1
      if (gap > maxGapMs) maxGapMs = gap
    }
  }

  const tickCount = ticks.length
  const coveragePct = Math.min(
    100,
    expectedTicks > 0 ? (tickCount / expectedTicks) * 100 : 0
  )
  const firstTickAt = ticks[0] ? Number(ticks[0].ts) : null
  const lastTickAt = ticks.length ? Number(ticks[ticks.length - 1]!.ts) : null
  const tickCloseUsd = ticks.length ? ticks[ticks.length - 1]!.usdOz : null

  const bar = await prisma.dailyBar.findUnique({ where: { date: dateKey } })
  const dailyBarSource = bar?.source ?? null
  const dailyBarFrozen = dailyBarSource === TICK_FINAL_SOURCE
  const barClose =
    bar != null && bar.source.startsWith('tick:') ? bar.close : tickCloseUsd

  let currencyCloseUsd: number | null = null
  let currencyCloseDiff: number | null = null
  try {
    currencyCloseUsd = await fetchCurrencyCloseUsd(dateKey)
    if (
      currencyCloseUsd != null &&
      barClose != null &&
      Number.isFinite(barClose)
    ) {
      currencyCloseDiff = barClose - currencyCloseUsd
    }
  } catch (err) {
    logger.warn('daily quality currency fetch failed', dateKey, err)
  }

  const notes: string[] = []
  if (tickCount === 0) notes.push('无 tick')
  else if (coveragePct < 50) notes.push('覆盖偏低')
  if (gapCount > 0) notes.push(`断档${gapCount}次`)
  if (dailyBarFrozen) notes.push('已冻结')
  else if (dailyBarSource?.startsWith('tick:')) notes.push('tick日线未冻结')
  else if (dailyBarSource?.startsWith('currency-api'))
    notes.push('仅currency日线')

  const row = await prisma.dailyQuality.upsert({
    where: { date: dateKey },
    create: {
      date: dateKey,
      tickCount,
      expectedTicks,
      coveragePct,
      gapCount,
      maxGapMs,
      firstTickAt: firstTickAt != null ? BigInt(firstTickAt) : null,
      lastTickAt: lastTickAt != null ? BigInt(lastTickAt) : null,
      dailyBarSource,
      dailyBarFrozen,
      currencyCloseDiff,
      currencyCloseUsd,
      tickCloseUsd: barClose,
      note: notes.length ? notes.join(' · ') : null
    },
    update: {
      tickCount,
      expectedTicks,
      coveragePct,
      gapCount,
      maxGapMs,
      firstTickAt: firstTickAt != null ? BigInt(firstTickAt) : null,
      lastTickAt: lastTickAt != null ? BigInt(lastTickAt) : null,
      dailyBarSource,
      dailyBarFrozen,
      currencyCloseDiff,
      currencyCloseUsd,
      tickCloseUsd: barClose,
      note: notes.length ? notes.join(' · ') : null
    }
  })

  return toDto(row)
}

/** 冻结后写昨日质量；启动时可补最近几天缺口 */
export async function runYesterdayDailyQuality(): Promise<DailyQualityRow> {
  const yesterday = shiftDateKey(localDateKey(), -1)
  const row = await upsertDailyQuality(yesterday)
  logger.info(
    'daily quality',
    `${row.date} coverage=${row.coveragePct.toFixed(1)}% gaps=${row.gapCount}`
  )
  return row
}

export async function listDailyQuality(opts?: {
  date?: string;
  from?: string;
  to?: string;
  limit?: number;
}): Promise<DailyQualityRow[]> {
  if (opts?.date && /^\d{4}-\d{2}-\d{2}$/.test(opts.date)) {
    const one = await prisma.dailyQuality.findUnique({
      where: { date: opts.date }
    })
    return one ? [toDto(one)] : []
  }

  const where: { date?: { gte?: string; lte?: string } } = {}
  if (opts?.from && /^\d{4}-\d{2}-\d{2}$/.test(opts.from)) {
    where.date = { ...(where.date || {}), gte: opts.from }
  }
  if (opts?.to && /^\d{4}-\d{2}-\d{2}$/.test(opts.to)) {
    where.date = { ...(where.date || {}), lte: opts.to }
  }
  let take = Number(opts?.limit)
  if (!Number.isFinite(take) || take <= 0) take = 30
  take = Math.min(365, Math.floor(take))

  const rows = await prisma.dailyQuality.findMany({
    where,
    orderBy: { date: 'desc' },
    take
  })
  return rows.map(toDto)
}
