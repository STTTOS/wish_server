import { FETCH_TIMEOUT_MS, OZ_TO_G } from '../config'
import { logger } from '../logger'

export type GoldQuote = {
  ts: number;
  usdOz: number;
  usdCny: number | null;
  cnyG: number | null;
  source: string;
  sourceUpdatedAt?: string;
};

/** 汇率拉取结果（含来源，便于 health / 日志对照） */
export type FxQuote = {
  rate: number;
  source: string;
  /** 上游声明的更新时间（若有） */
  updatedAt?: string | null;
};

async function fetchJson(
  url: string,
  timeoutMs = FETCH_TIMEOUT_MS
): Promise<unknown> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'wishufree-gold-server/1.0',
      Accept: 'application/json'
    },
    signal: AbortSignal.timeout(timeoutMs)
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

function asPositiveRate(n: unknown): number | null {
  const v = typeof n === 'number' ? n : Number(n)
  return Number.isFinite(v) && v > 0 ? v : null
}

/**
 * 可选：ExchangeRate-API 正式档（有 KEY 时优先）。
 * https://www.exchangerate-api.com/docs/standard-requests
 */
async function fetchFxExchangeRateApiKey(): Promise<FxQuote | null> {
  const key = (process.env.EXCHANGE_RATE_API_KEY || '').trim()
  if (!key) return null
  const data = (await fetchJson(
    `https://v6.exchangerate-api.com/v6/${encodeURIComponent(key)}/latest/USD`
  )) as {
    result?: string;
    rates?: { CNY?: number };
    time_last_update_utc?: string;
  }
  if (data.result && data.result !== 'success') return null
  const rate = asPositiveRate(data.rates?.CNY)
  if (rate == null) return null
  return {
    rate,
    source: 'exchangerate-api',
    updatedAt: data.time_last_update_utc ?? null
  }
}

/**
 * 开放端点（无需 key）：与正式档同系 mid，日更；作无 key 时的主源。
 * 不宜当作「唯一官方价」，但比单一 currency-api 更稳、对照市价更近。
 */
async function fetchFxOpenErApi(): Promise<FxQuote | null> {
  const data = (await fetchJson('https://open.er-api.com/v6/latest/USD')) as {
    result?: string;
    rates?: { CNY?: number };
    time_last_update_utc?: string;
  }
  if (data.result && data.result !== 'success') return null
  const rate = asPositiveRate(data.rates?.CNY)
  if (rate == null) return null
  return {
    rate,
    source: 'open.er-api',
    updatedAt: data.time_last_update_utc ?? null
  }
}

/** 原主源：fawazahmed0 currency-api（偶发 403 / 粘滞，作兜底） */
async function fetchFxCurrencyApi(): Promise<FxQuote | null> {
  const data = (await fetchJson(
    'https://latest.currency-api.pages.dev/v1/currencies/usd.json'
  )) as { usd?: { cny?: number } }
  const rate = asPositiveRate(data?.usd?.cny)
  if (rate == null) return null
  return { rate, source: 'currency-api', updatedAt: null }
}

/** ECB 系日参考（Frankfurter）；CNY 可用性视上游，作末位兜底 */
async function fetchFxFrankfurter(): Promise<FxQuote | null> {
  const data = (await fetchJson(
    'https://api.frankfurter.app/latest?from=USD&to=CNY'
  )) as { rates?: { CNY?: number }; date?: string }
  const rate = asPositiveRate(data.rates?.CNY)
  if (rate == null) return null
  return {
    rate,
    source: 'frankfurter',
    updatedAt: data.date ?? null
  }
}

type FxFetcher = () => Promise<FxQuote | null>;

/**
 * USD/CNY 多源级联：有 KEY → 正式档；否则 open.er-api → currency-api → frankfurter。
 * 任一成功即返回；全部失败返回 null（poller 沿用缓存）。
 */
export async function fetchUsdCny(): Promise<FxQuote | null> {
  const chain: { name: string; run: FxFetcher }[] = [
    { name: 'exchangerate-api-key', run: fetchFxExchangeRateApiKey },
    { name: 'open.er-api', run: fetchFxOpenErApi },
    { name: 'currency-api', run: fetchFxCurrencyApi },
    { name: 'frankfurter', run: fetchFxFrankfurter }
  ]
  for (const { name, run } of chain) {
    try {
      const q = await run()
      if (q != null) return q
    } catch (err) {
      logger.warn('fx source failed', name, err)
    }
  }
  return null
}

/**
 * 现货只认 gold-api。
 * 不再用 currency-api XAU 兜底：那是日级近似，poller 也不会落 Tick，
 * 失败时反而多耗一次超时、把断采记成 skip。
 */
async function fetchGoldSpot(): Promise<{
  usd: number;
  source: string;
  sourceUpdatedAt?: string;
}> {
  const data = (await fetchJson('https://api.gold-api.com/price/XAU')) as {
    price?: number;
    updatedAt?: string;
    updatedAtReadable?: string;
  }
  if (!data?.price) throw new Error('无价格')
  return {
    usd: Number(data.price),
    source: 'gold-api',
    sourceUpdatedAt: data.updatedAt || data.updatedAtReadable
  }
}

export async function fetchQuote(cachedFx?: number | null): Promise<GoldQuote> {
  let fx = cachedFx != null && cachedFx > 0 ? cachedFx : null
  if (fx == null) {
    const q = await fetchUsdCny()
    fx = q?.rate ?? null
  }
  const gold = await fetchGoldSpot()
  let cnyG: number | null = null
  if (fx != null && fx > 0) {
    cnyG = (gold.usd * fx) / OZ_TO_G
  }
  return {
    ts: Date.now(),
    usdOz: gold.usd,
    usdCny: fx,
    cnyG,
    source: gold.source,
    sourceUpdatedAt: gold.sourceUpdatedAt
  }
}
