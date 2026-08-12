import Router from 'koa-router'

import { apiPrefix } from '../config'
import { HTTP_STATUS } from '../constants/httpStatus'
import prisma from '../models'
import { syncDailyHistory } from '../services/dailySync'
import { getPollerStatus } from '../services/poller'
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
  source: string;
}) {
  return {
    date: row.date,
    ts: Number(row.ts),
    open: row.open,
    high: row.high,
    low: row.low,
    close: row.close,
    source: row.source
  }
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

/** 最新一条现货 */
router.get('/spot', async (ctx) => {
  const latest = await prisma.tick.findFirst({ orderBy: { ts: 'desc' } })
  if (!latest) {
    response.error(ctx, HTTP_STATUS.NOT_FOUND, '暂无行情')
    return
  }
  response.success(ctx, toTickDto(latest))
})

/**
 * 补洞 / 拉取区间 tick
 * query: since (ms, exclusive), until (ms, inclusive), limit (default 5000, max 20000)
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
    truncated: rows.length >= limit
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

export default router
