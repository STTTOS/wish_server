import { FETCH_TIMEOUT_MS, OZ_TO_G } from '../config'

export type GoldQuote = {
  ts: number;
  usdOz: number;
  usdCny: number | null;
  cnyG: number | null;
  source: string;
  sourceUpdatedAt?: string;
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

/** 汇率仍用 currency-api（与 XAU 日级近似价无关） */
export async function fetchUsdCny(): Promise<number | null> {
  try {
    const data = (await fetchJson(
      'https://latest.currency-api.pages.dev/v1/currencies/usd.json'
    )) as { usd?: { cny?: number } }
    return data?.usd?.cny ? Number(data.usd.cny) : null
  } catch {
    return null
  }
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
  const fx = cachedFx ?? (await fetchUsdCny())
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
