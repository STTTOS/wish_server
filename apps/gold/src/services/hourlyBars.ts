/** Tick → 小时 OHLC（UTC 整点），与 london-gold electron/hourlyBars 对齐（仅聚合） */

export type HourlyBar = {
  ts: number;
  open: number;
  high: number;
  low: number;
  close: number;
  ticks: number;
  source: 'tick-agg';
};

export type TickQuote = {
  ts: number;
  usdOz: number;
};

const HOUR_MS = 60 * 60 * 1000

function hourStart(ts: number): number {
  return Math.floor(ts / HOUR_MS) * HOUR_MS
}

/** 将 tick 聚合成小时 OHLC（按 UTC 整点） */
export function aggregateTicksToHourly(quotes: TickQuote[]): HourlyBar[] {
  if (quotes.length === 0) return []
  const map = new Map<number, HourlyBar>()
  for (const q of quotes) {
    if (!(q.ts > 0) || !(q.usdOz > 0)) continue
    const key = hourStart(q.ts)
    const prev = map.get(key)
    if (!prev) {
      map.set(key, {
        ts: key,
        open: q.usdOz,
        high: q.usdOz,
        low: q.usdOz,
        close: q.usdOz,
        ticks: 1,
        source: 'tick-agg'
      })
    } else {
      prev.high = Math.max(prev.high, q.usdOz)
      prev.low = Math.min(prev.low, q.usdOz)
      prev.close = q.usdOz
      prev.ticks += 1
    }
  }
  return [...map.values()].sort((a, b) => a.ts - b.ts)
}
