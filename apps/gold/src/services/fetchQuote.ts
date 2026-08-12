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

async function fetchGoldPrimary(): Promise<{
  usd: number;
  source: string;
  sourceUpdatedAt?: string;
  cnyPerOz?: number;
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

async function fetchGoldFallback(): Promise<{
  usd: number;
  source: string;
  sourceUpdatedAt?: string;
  cnyPerOz?: number;
}> {
  const data = (await fetchJson(
    'https://latest.currency-api.pages.dev/v1/currencies/xau.json'
  )) as { date?: string; xau?: { usd?: number; cny?: number } }
  const usd = Number(data?.xau?.usd)
  if (!usd) throw new Error('备用源无 XAU/USD')
  const cnyPerOz = data.xau?.cny != null ? Number(data.xau.cny) : undefined
  return {
    usd,
    source: 'currency-api',
    sourceUpdatedAt: data.date,
    cnyPerOz
  }
}

async function fetchGold() {
  try {
    return await fetchGoldPrimary()
  } catch {
    return await fetchGoldFallback()
  }
}

export async function fetchQuote(cachedFx?: number | null): Promise<GoldQuote> {
  let fx = cachedFx ?? (await fetchUsdCny())
  const gold = await fetchGold()
  if ((fx == null || fx <= 0) && gold.cnyPerOz != null && gold.usd > 0) {
    fx = gold.cnyPerOz / gold.usd
  }
  let cnyG: number | null = null
  if (fx != null && fx > 0) {
    cnyG = (gold.usd * fx) / OZ_TO_G
  } else if (gold.cnyPerOz != null) {
    cnyG = gold.cnyPerOz / OZ_TO_G
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
