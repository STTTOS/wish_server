import { pollIntervalMs } from '../config'
import { logger } from '../logger'
import prisma from '../models'
import { rollTodayFromSpot } from './dailySync'
import { fetchQuote, fetchUsdCny } from './fetchQuote'

let timer: NodeJS.Timeout | null = null
let inFlight = false
let cachedFx: number | null = null
let lastQuoteAt = 0
let lastError: string | null = null
let startedAt = 0

export function getPollerStatus() {
  return {
    running: timer != null,
    intervalMs: pollIntervalMs,
    lastQuoteAt: lastQuoteAt || null,
    lastError,
    startedAt: startedAt || null,
    cachedFx
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

  // currency-api 是日级近似，写入 Tick 会在图上造成针状尖刺；仅允许 gold-api 等现货源落库
  if (
    quote.source === 'currency-api' ||
    quote.source.startsWith('currency-api')
  ) {
    lastError = `skip tick: ${quote.source} is daily approx, not spot`
    logger.warn(lastError, {
      usdOz: quote.usdOz,
      sourceUpdatedAt: quote.sourceUpdatedAt
    })
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
  } finally {
    inFlight = false
  }
}

function scheduleNext() {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    void (async () => {
      await tickOnce()
      scheduleNext()
    })()
  }, pollIntervalMs)
}

export function startPricePoller() {
  if (timer) return
  startedAt = Date.now()
  logger.info(`price poller start interval=${pollIntervalMs}ms`)
  void (async () => {
    await tickOnce()
    scheduleNext()
  })()
}

export function stopPricePoller() {
  if (timer) clearTimeout(timer)
  timer = null
}
