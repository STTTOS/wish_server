/**
 * 国际金 / COMEX 风格交易日：UTC 22:00 滚入下一根日线。
 * 与 weekend 停采（UTC 五 22:00 → 日 22:00）及 london-gold `electron/goldTradingDay.ts` 对齐。
 *
 * 交易日 2026-08-22 = [2026-08-21T22:00:00Z, 2026-08-22T22:00:00Z)
 * date 标签取该区间收盘时刻所在的 UTC 日历日。
 */
export const GOLD_TRADING_DAY_ROLLOVER_UTC_HOUR = 22

const MS_PER_DAY = 86_400_000

export function tradingDayStartMs(ts: number): number {
  const d = new Date(ts)
  const y = d.getUTCFullYear()
  const m = d.getUTCMonth()
  const day = d.getUTCDate()
  if (d.getUTCHours() >= GOLD_TRADING_DAY_ROLLOVER_UTC_HOUR) {
    return Date.UTC(y, m, day, GOLD_TRADING_DAY_ROLLOVER_UTC_HOUR, 0, 0, 0)
  }
  const prev = new Date(Date.UTC(y, m, day))
  prev.setUTCDate(prev.getUTCDate() - 1)
  return Date.UTC(
    prev.getUTCFullYear(),
    prev.getUTCMonth(),
    prev.getUTCDate(),
    GOLD_TRADING_DAY_ROLLOVER_UTC_HOUR,
    0,
    0,
    0
  )
}

/** 交易日标签 YYYY-MM-DD（收盘 UTC 日） */
export function tradingDayKeyFromTs(ts: number): string {
  const end = tradingDayStartMs(ts) + MS_PER_DAY
  const d = new Date(end)
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 交易日 dateKey 对应的会话区间 [from, toExcl) */
export function tradingDayBoundsMs(dateKey: string): {
  from: number;
  toExcl: number;
} {
  const [y, m, d] = dateKey.split('-').map(Number)
  const toExcl = Date.UTC(
    y!,
    m! - 1,
    d!,
    GOLD_TRADING_DAY_ROLLOVER_UTC_HOUR,
    0,
    0,
    0
  )
  return { from: toExcl - MS_PER_DAY, toExcl }
}

export function isSameTradingDay(a: number, b: number): boolean {
  return tradingDayKeyFromTs(a) === tradingDayKeyFromTs(b)
}
