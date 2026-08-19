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

type ChinamoneySpotRow = {
  ccyPair?: string;
  bidPrc?: string | number;
  askPrc?: string | number;
  midprice?: string | number;
  time?: string;
};

/**
 * 中国货币网「人民币外汇即期报价」页面同源 JSON（非官方 CMDS）。
 * mid 优先；否则 (bid+ask)/2。对标在岸价，比境外 mid 更贴近百度/积存金对照。
 * https://www.chinamoney.com.cn/chinese/mkdatapfx/
 */
async function fetchFxChinamoney(): Promise<FxQuote | null> {
  const url =
    'https://www.chinamoney.com.cn/r/cms/www/chinamoney/data/fx/rfx-sp-quot.json'
  const body = new URLSearchParams({ t: String(Date.now()) })
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Accept: 'application/json, text/plain, */*',
      'Content-Type': 'application/x-www-form-urlencoded',
      Origin: 'https://www.chinamoney.com.cn',
      Referer: 'https://www.chinamoney.com.cn/chinese/mkdatapfx/'
    },
    body,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = (await res.json()) as { records?: ChinamoneySpotRow[] }
  const row = (data.records ?? []).find(
    (r) => String(r.ccyPair || '').replace(/\s/g, '') === 'USD/CNY'
  )
  if (!row) return null

  const mid = asPositiveRate(row.midprice)
  const bid = asPositiveRate(row.bidPrc)
  const ask = asPositiveRate(row.askPrc)
  let rate = mid
  if (rate == null && bid != null && ask != null) rate = (bid + ask) / 2
  else if (rate == null) rate = bid ?? ask
  if (rate == null) return null

  const updatedAt =
    typeof row.time === 'string' && row.time.trim() ? row.time.trim() : null
  return { rate, source: 'chinamoney', updatedAt }
}

/** 兜底：fawazahmed0 currency-api */
async function fetchFxCurrencyApi(): Promise<FxQuote | null> {
  const data = (await fetchJson(
    'https://latest.currency-api.pages.dev/v1/currencies/usd.json'
  )) as { usd?: { cny?: number } }
  const rate = asPositiveRate(data?.usd?.cny)
  if (rate == null) return null
  return { rate, source: 'currency-api', updatedAt: null }
}

type FxFetcher = () => Promise<FxQuote | null>;

/**
 * USD/CNY：货币网即期（爬虫）→ currency-api。
 * 任一成功即返回；全部失败返回 null（poller 沿用缓存）。
 */
export async function fetchUsdCny(): Promise<FxQuote | null> {
  const chain: { name: string; run: FxFetcher }[] = [
    { name: 'chinamoney', run: fetchFxChinamoney },
    { name: 'currency-api', run: fetchFxCurrencyApi }
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
