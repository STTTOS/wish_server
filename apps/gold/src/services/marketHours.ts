/**
 * 伦敦金零售常见周末休市（与多数 FX/贵金属经纪商一致）：
 * 周五 22:00 UTC 收 → 周日 22:00 UTC 开。
 * 北京时间约：周六 06:00 收 → 周一 06:00 开。
 *
 * 不依赖上游 API 是否仍返回 JSON（周末常有陈旧价）。
 */

/** 周五收盘 / 周日开盘：UTC 22:00 */
const SESSION_UTC_MIN = 22 * 60

/** 该时刻是否在开市时段（可采价） */
export function isGoldMarketOpen(ts: number = Date.now()): boolean {
  const d = new Date(ts)
  // 0=Sun … 5=Fri 6=Sat
  const day = d.getUTCDay()
  const minutes = d.getUTCHours() * 60 + d.getUTCMinutes()

  // 周六 UTC 全休
  if (day === 6) return false
  // 周日开盘前
  if (day === 0 && minutes < SESSION_UTC_MIN) return false
  // 周五收盘后
  if (day === 5 && minutes >= SESSION_UTC_MIN) return false
  return true
}

/** 区间内开市毫秒数（按 UTC 分钟边界切，收盘整分起不计） */
export function openMsInRange(start: number, endExclusive: number): number {
  if (!(endExclusive > start)) return 0
  const step = 60_000
  let open = 0
  let t = start
  while (t < endExclusive) {
    const minuteStart = Math.floor(t / step) * step
    const sliceEnd = Math.min(minuteStart + step, endExclusive)
    if (isGoldMarketOpen(minuteStart)) open += sliceEnd - t
    t = sliceEnd
  }
  return open
}

/** 下一开市时刻；若已开市则返回 ts */
export function nextMarketOpenAt(ts: number = Date.now()): number {
  if (isGoldMarketOpen(ts)) return ts
  const step = 60_000
  let t = Math.ceil(ts / step) * step
  const limit = ts + 4 * 86_400_000
  while (t < limit) {
    if (isGoldMarketOpen(t)) return t
    t += step
  }
  return ts + step
}

/** API 用：休市标记 + 下次开市 */
export function marketSessionDto(now: number = Date.now()) {
  const marketOpen = isGoldMarketOpen(now)
  return {
    marketOpen,
    marketClosed: !marketOpen,
    nextMarketOpenAt: marketOpen ? null : nextMarketOpenAt(now)
  }
}
