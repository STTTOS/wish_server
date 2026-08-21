import Router from 'koa-router'

import { apiPrefix } from '../config'
import { HTTP_STATUS } from '../constants/httpStatus'
import prisma from '../models'
import {
  listDailyQuality,
  runYesterdayDailyQuality,
  upsertDailyQuality
} from '../services/dailyQuality'
import { syncDailyHistory } from '../services/dailySync'
import { getPollerStatus } from '../services/poller'
import { listPollLogs, type PollLogKind } from '../services/pollLog'
import { marketSessionDto } from '../services/marketHours'
import {
  buildSwingFeatures,
  clampMinAmpCnyG,
  clampSwingHours
} from '../services/swingFeatures'
import response from '../utils/response'

const router = new Router({ prefix: apiPrefix })

function toTickDto(row: {
  ts: bigint;
  usdOz: number;
  usdCny: number | null;
  cnyG: number | null;
  source: string;
  sourceUpdatedAt: string | null;
}) {
  return {
    ts: Number(row.ts),
    usdOz: row.usdOz,
    usdCny: row.usdCny,
    cnyG: row.cnyG,
    source: row.source,
    sourceUpdatedAt: row.sourceUpdatedAt
  }
}

function toDailyDto(row: {
  date: string;
  ts: bigint;
  open: number;
  high: number;
  low: number;
  close: number;
  usdCnyClose: number | null;
  source: string;
}) {
  return {
    date: row.date,
    ts: Number(row.ts),
    open: row.open,
    high: row.high,
    low: row.low,
    close: row.close,
    usdCnyClose: row.usdCnyClose,
    source: row.source
  }
}

function queryNumber(
  raw: string | string[] | undefined,
  fallback: number
): number {
  if (raw == null || raw === '') return fallback
  const n = Number(Array.isArray(raw) ? raw[0] : raw)
  return Number.isFinite(n) ? n : fallback
}

router.get('/health', async (ctx) => {
  const latest = await prisma.tick.findFirst({ orderBy: { ts: 'desc' } })
  const dailyCount = await prisma.dailyBar.count()
  response.success(ctx, {
    service: 'gold',
    poller: getPollerStatus(),
    latestTickAt: latest ? Number(latest.ts) : null,
    tickLagMs: latest ? Date.now() - Number(latest.ts) : null,
    dailyCount
  })
})

/**
 * 采价失败 / skip 日志（轻量；成功不写）
 * query: limit=50, kind=error|skip
 */
router.get('/poll-logs', async (ctx) => {
  const limit = queryNumber(ctx.query.limit, 50)
  const kindRaw = ctx.query.kind
  const kindStr =
    kindRaw != null
      ? String(Array.isArray(kindRaw) ? kindRaw[0] : kindRaw)
      : ''
  const kind =
    kindStr === 'error' || kindStr === 'skip'
      ? (kindStr as PollLogKind)
      : undefined
  const list = await listPollLogs({ limit, kind })
  response.success(ctx, { list, count: list.length })
})

/** 最新一条现货（含休市标记；休市时仍返回库内最新 tick） */
router.get('/spot', async (ctx) => {
  const latest = await prisma.tick.findFirst({ orderBy: { ts: 'desc' } })
  if (!latest) {
    response.error(ctx, HTTP_STATUS.NOT_FOUND, '暂无行情')
    return
  }
  response.success(ctx, {
    ...toTickDto(latest),
    ...marketSessionDto()
  })
})

/**
 * 补洞 / 拉取区间 tick
 * query: since (ms, exclusive), until (ms, inclusive), limit (default 5000, max 20000)
 * 响应含 marketClosed / nextMarketOpenAt（与现货是否新增无关）
 */
router.get('/ticks', async (ctx) => {
  const sinceRaw = ctx.query.since
  const untilRaw = ctx.query.until
  const limitRaw = ctx.query.limit

  const since =
    sinceRaw != null && sinceRaw !== ''
      ? Number(Array.isArray(sinceRaw) ? sinceRaw[0] : sinceRaw)
      : NaN
  const until =
    untilRaw != null && untilRaw !== ''
      ? Number(Array.isArray(untilRaw) ? untilRaw[0] : untilRaw)
      : NaN
  let limit = Number(Array.isArray(limitRaw) ? limitRaw[0] : limitRaw)
  if (!Number.isFinite(limit) || limit <= 0) limit = 5000
  limit = Math.min(20_000, Math.floor(limit))

  const where: { ts?: { gt?: bigint; lte?: bigint } } = {}
  if (Number.isFinite(since)) {
    where.ts = { ...(where.ts || {}), gt: BigInt(Math.floor(since)) }
  }
  if (Number.isFinite(until)) {
    where.ts = { ...(where.ts || {}), lte: BigInt(Math.floor(until)) }
  }

  const rows = await prisma.tick.findMany({
    where,
    orderBy: { ts: 'asc' },
    take: limit
  })

  response.success(ctx, {
    list: rows.map(toTickDto),
    count: rows.length,
    truncated: rows.length >= limit,
    ...marketSessionDto()
  })
})

/**
 * 日线 OHLC
 * query: from=YYYY-MM-DD, to=YYYY-MM-DD
 */
router.get('/daily', async (ctx) => {
  const fromRaw = ctx.query.from
  const toRaw = ctx.query.to
  const from =
    fromRaw != null
      ? String(Array.isArray(fromRaw) ? fromRaw[0] : fromRaw)
      : ''
  const to =
    toRaw != null ? String(Array.isArray(toRaw) ? toRaw[0] : toRaw) : ''

  const where: { date?: { gte?: string; lte?: string } } = {}
  if (/^\d{4}-\d{2}-\d{2}$/.test(from)) {
    where.date = { ...(where.date || {}), gte: from }
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    where.date = { ...(where.date || {}), lte: to }
  }

  const rows = await prisma.dailyBar.findMany({
    where,
    orderBy: { date: 'asc' }
  })

  response.success(ctx, {
    list: rows.map(toDailyDto),
    count: rows.length,
    from: rows[0]?.date ?? null,
    to: rows[rows.length - 1]?.date ?? null
  })
})

/** 手动触发日线同步（bootstrap / 增量） */
router.post('/daily/sync', async (ctx) => {
  try {
    const result = await syncDailyHistory()
    response.success(ctx, result, result.message)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    response.error(ctx, HTTP_STATUS.INTERNAL_SERVER_ERROR, msg)
  }
})

/**
 * 只读波段特征：Tick → H1 → 正向低→高腿（与桌面端同算法）
 * query: hours (6–168, default 48), minAmpCnyG (≥10, default 10), includeBars (0|1)
 */
router.get('/features/swing', async (ctx) => {
  try {
    const hours = clampSwingHours(queryNumber(ctx.query.hours, 48))
    const minAmpCnyG = clampMinAmpCnyG(queryNumber(ctx.query.minAmpCnyG, 10))
    const includeRaw = ctx.query.includeBars
    const includeBars =
      includeRaw === '1' ||
      includeRaw === 'true' ||
      (Array.isArray(includeRaw) &&
        (includeRaw[0] === '1' || includeRaw[0] === 'true'))

    const data = await buildSwingFeatures({
      hours,
      minAmpCnyG,
      includeBars
    })
    response.success(ctx, data)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    response.error(ctx, HTTP_STATUS.INTERNAL_SERVER_ERROR, msg)
  }
})

/**
 * 日终 / 当日原料质量快照
 * query: date=YYYY-MM-DD | from=&to=&limit=&includeToday=0|1（默认 1，列表时现算今天）
 */
router.get('/features/quality', async (ctx) => {
  try {
    const dateRaw = ctx.query.date
    const date =
      dateRaw != null
        ? String(Array.isArray(dateRaw) ? dateRaw[0] : dateRaw)
        : ''
    const fromRaw = ctx.query.from
    const toRaw = ctx.query.to
    const from =
      fromRaw != null
        ? String(Array.isArray(fromRaw) ? fromRaw[0] : fromRaw)
        : ''
    const to =
      toRaw != null ? String(Array.isArray(toRaw) ? toRaw[0] : toRaw) : ''
    const limit = queryNumber(ctx.query.limit, 30)
    const includeRaw = ctx.query.includeToday
    const includeToday =
      includeRaw !== '0' &&
      includeRaw !== 'false' &&
      !(
        Array.isArray(includeRaw) &&
        (includeRaw[0] === '0' || includeRaw[0] === 'false')
      )

    const list = await listDailyQuality({
      date: date || undefined,
      from: from || undefined,
      to: to || undefined,
      limit,
      includeToday
    })
    response.success(ctx, { list, count: list.length })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    response.error(ctx, HTTP_STATUS.INTERNAL_SERVER_ERROR, msg)
  }
})

/**
 * 手动重算某日质量（默认昨日）
 * body/query: date=YYYY-MM-DD
 */
router.post('/features/quality/run', async (ctx) => {
  try {
    const body = (ctx.request.body || {}) as { date?: string }
    const q = ctx.query.date
    const raw =
      body.date || (q != null ? String(Array.isArray(q) ? q[0] : q) : '') || ''
    const row =
      raw && /^\d{4}-\d{2}-\d{2}$/.test(raw)
        ? await upsertDailyQuality(raw)
        : await runYesterdayDailyQuality()
    response.success(ctx, row, `已写入日终质量 ${row.date}`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    response.error(ctx, HTTP_STATUS.INTERNAL_SERVER_ERROR, msg)
  }
})

export default router
