import {
  closedPollIntervalMs,
  fxRefreshIntervalMs,
  pollIntervalMs
} from '../config'
import { logger } from '../logger'
import prisma from '../models'
import { rollTodayFromSpot } from './dailySync'
import { fetchQuote, fetchUsdCny } from './fetchQuote'
import { isGoldMarketOpen, nextMarketOpenAt } from './marketHours'
import { recordPollEvent } from './pollLog'

let timer: NodeJS.Timeout | null = null
let inFlight = false
let cachedFx: number | null = null
let cachedFxSource: string | null = null
/** 上次成功刷新汇率的墙上时间 */
let lastFxAt = 0
let lastError: string | null = null
let startedAt = 0
/** 下一轮预计发起时刻（墙上） */
let nextDueAt = 0
let lastQuoteAt = 0
/** 上一轮是否休市：用于开盘瞬间打 resume 日志 */
let wasClosed = false

export function getPollerStatus() {
  const now = Date.now()
  const marketOpen = isGoldMarketOpen(now)
  return {
    running: startedAt > 0,
    intervalMs: pollIntervalMs,
    closedPollIntervalMs,
    fxRefreshIntervalMs,
    lastQuoteAt: lastQuoteAt || null,
    lastFxAt: lastFxAt || null,
    lastError,
    startedAt: startedAt || null,
    nextDueAt: nextDueAt || null,
    cachedFx,
    cachedFxSource,
    marketOpen,
    nextMarketOpenAt: marketOpen ? null : nextMarketOpenAt(now)
  }
}

/** 无缓存或已过刷新间隔则重拉；失败保留旧值 */
async function ensureFx(): Promise<number | null> {
  const now = Date.now()
  const stale =
    cachedFx == null || lastFxAt <= 0 || now - lastFxAt >= fxRefreshIntervalMs
  if (!stale) return cachedFx

  try {
    const fx = await fetchUsdCny()
    if (fx != null && fx.rate > 0) {
      const prev = cachedFx
      cachedFx = fx.rate
      cachedFxSource = fx.source
      lastFxAt = now
      if (prev != null && Math.abs(prev - fx.rate) / prev > 0.001) {
        logger.info('usd/cny refreshed', {
          prev,
          fx: fx.rate,
          source: fx.source,
          updatedAt: fx.updatedAt ?? null
        })
      }
      return cachedFx
    }
  } catch (err) {
    logger.warn('usd/cny refresh failed, keep cache', err)
  }
  return cachedFx
}

async function persistQuote() {
  const fx = await ensureFx()
  const quote = await fetchQuote(fx)
  if (quote.usdCny != null && quote.usdCny > 0) {
    cachedFx = quote.usdCny
    if (lastFxAt <= 0) lastFxAt = Date.now()
  }

  // 现货只走 gold-api；若将来误接日级源，仍禁止落 Tick
  if (
    quote.source === 'currency-api' ||
    quote.source.startsWith('currency-api')
  ) {
    lastError = `skip tick: ${quote.source} is daily approx, not spot`
    logger.warn(lastError, {
      usdOz: quote.usdOz,
      sourceUpdatedAt: quote.sourceUpdatedAt
    })
    await recordPollEvent('skip', lastError).catch((e) =>
      logger.warn('record poll event failed', e)
    )
    return null
  }

  await prisma.tick.create({
    data: {
      ts: BigInt(quote.ts),
      usdOz: quote.usdOz,
      usdCny: quote.usdCny,
      cnyG: quote.cnyG,
      source: quote.source,
      sourceUpdatedAt: quote.sourceUpdatedAt ?? null
    }
  })
  lastQuoteAt = quote.ts
  lastError = null

  try {
    await rollTodayFromSpot(quote.usdOz, quote.source, quote.usdCny)
  } catch (err) {
    logger.warn('roll today daily bar failed', err)
  }

  return quote
}

async function tickOnce() {
  if (inFlight) return
  inFlight = true
  try {
    await persistQuote()
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    lastError = msg
    logger.error('poll failed', msg)
    await recordPollEvent('error', msg).catch((e) =>
      logger.warn('record poll event failed', e)
    )
  } finally {
    inFlight = false
  }
}

function arm(delayMs: number) {
  if (timer) clearTimeout(timer)
  const wait = Math.max(0, delayMs)
  nextDueAt = Date.now() + wait
  timer = setTimeout(() => {
    void runRound()
  }, wait)
}

/**
 * 休市：不请求上游。
 * 短睡轮询（默认 ≤30s），禁止一次 setTimeout 睡到开盘（重启也不会恢复长定时器）。
 */
async function skipWhileClosed(): Promise<boolean> {
  const now = Date.now()
  if (isGoldMarketOpen(now)) return false

  const openAt = nextMarketOpenAt(now)
  const untilOpen = Math.max(0, openAt - now)
  const waitMs = Math.min(
    closedPollIntervalMs,
    Math.max(pollIntervalMs, untilOpen || closedPollIntervalMs)
  )

  lastError = 'skip: market closed (Fri 22:00 UTC → Sun 22:00 UTC)'
  // 进入休市首轮打 info；之后靠 PollLog 合并计数，避免刷屏
  if (!wasClosed) {
    logger.info(lastError, {
      nextOpenAt: openAt,
      waitMs,
      closedPollIntervalMs,
      mode: 'short-sleep'
    })
  }
  wasClosed = true

  await recordPollEvent('skip', lastError).catch((e) =>
    logger.warn('record poll event failed', e)
  )
  arm(waitMs)
  return true
}

function noteMarketResumeIfNeeded() {
  if (!wasClosed) return
  wasClosed = false
  logger.info('poller resume: market open', {
    at: new Date().toISOString(),
    closedPollIntervalMs
  })
}

/** 墙上时钟：本轮耗时从 interval 里扣，使发起间隔 ≈ interval */
async function runRound() {
  if (!startedAt) return
  if (await skipWhileClosed()) return
  noteMarketResumeIfNeeded()
  const t0 = Date.now()
  await tickOnce()
  if (!startedAt) return
  if (!isGoldMarketOpen(Date.now())) {
    await skipWhileClosed()
    return
  }
  const elapsed = Date.now() - t0
  const delay = Math.max(0, pollIntervalMs - elapsed)
  arm(delay)
}

export function startPricePoller() {
  if (startedAt) return
  startedAt = Date.now()
  wasClosed = false
  logger.info(
    `price poller start interval=${pollIntervalMs}ms closedSleep≤${closedPollIntervalMs}ms fxRefresh=${fxRefreshIntervalMs}ms (wall-clock + short-sleep)`
  )
  void runRound()
}

export function stopPricePoller() {
  if (timer) clearTimeout(timer)
  timer = null
  startedAt = 0
  nextDueAt = 0
  lastFxAt = 0
  wasClosed = false
}

/**
 * 立刻打断当前等待并跑一轮（cron / 开盘对齐用）。
 * 不持久化：进程重启后靠 startPricePoller + 短睡即可自愈。
 */
export function kickPricePoller(reason: string) {
  if (!startedAt) {
    startPricePoller()
    logger.info('price poller kicked (was stopped)', { reason })
    return
  }
  if (timer) clearTimeout(timer)
  timer = null
  nextDueAt = Date.now()
  logger.info('price poller kicked', { reason })
  void runRound()
}
