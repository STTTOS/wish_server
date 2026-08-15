import { pollIntervalMs } from '../config'
import { logger } from '../logger'
import prisma from '../models'
import { rollTodayFromSpot } from './dailySync'
import { fetchQuote, fetchUsdCny } from './fetchQuote'
import { isGoldMarketOpen, nextMarketOpenAt } from './marketHours'
import { recordPollEvent } from './pollLog'

let timer: NodeJS.Timeout | null = null
let inFlight = false
let cachedFx: number | null = null
let lastQuoteAt = 0
let lastError: string | null = null
let startedAt = 0
/** 下一轮预计发起时刻（墙上） */
let nextDueAt = 0

export function getPollerStatus() {
  const now = Date.now()
  const marketOpen = isGoldMarketOpen(now)
  return {
    running: startedAt > 0,
    intervalMs: pollIntervalMs,
    lastQuoteAt: lastQuoteAt || null,
    lastError,
    startedAt: startedAt || null,
    nextDueAt: nextDueAt || null,
    cachedFx,
    marketOpen,
    nextMarketOpenAt: marketOpen ? null : nextMarketOpenAt(now)
  }
}

async function persistQuote() {
  if (cachedFx == null) {
    cachedFx = await fetchUsdCny()
  }
  const quote = await fetchQuote(cachedFx)
  if (quote.usdCny != null && quote.usdCny > 0) {
    cachedFx = quote.usdCny
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
    await rollTodayFromSpot(quote.usdOz, quote.source)
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
  nextDueAt = Date.now() + delayMs
  timer = setTimeout(() => {
    void runRound()
  }, delayMs)
}

/** 休市：不请求上游，睡到下次开市（最多一次睡到点） */
async function skipWhileClosed(): Promise<boolean> {
  const now = Date.now()
  if (isGoldMarketOpen(now)) return false
  const openAt = nextMarketOpenAt(now)
  const waitMs = Math.max(pollIntervalMs, openAt - now)
  lastError = 'skip: market closed (Fri 22:00 UTC → Sun 22:00 UTC)'
  logger.info(lastError, { nextOpenAt: openAt, waitMs })
  await recordPollEvent('skip', lastError).catch((e) =>
    logger.warn('record poll event failed', e)
  )
  arm(waitMs)
  return true
}

/** 墙上时钟：本轮耗时从 interval 里扣，使发起间隔 ≈ interval（请求慢于 interval 则立刻下一轮） */
async function runRound() {
  if (!startedAt) return
  if (await skipWhileClosed()) return
  const t0 = Date.now()
  await tickOnce()
  if (!startedAt) return
  // 本轮结束后若已进入休市，下一轮交给 skipWhileClosed 对齐开盘
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
  logger.info(`price poller start interval=${pollIntervalMs}ms (wall-clock)`)
  void runRound()
}

export function stopPricePoller() {
  if (timer) clearTimeout(timer)
  timer = null
  startedAt = 0
  nextDueAt = 0
}
