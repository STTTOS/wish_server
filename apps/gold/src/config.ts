export const port = process.env.SERVER_PORT || '7504'

export const apiPrefix = '/api'

export const OZ_TO_G = 31.1034768

export const pollIntervalMs = Math.max(
  1000,
  Number(process.env.POLL_INTERVAL_MS || 5000)
)

/**
 * 现货 / 汇率 HTTP 超时。默认 = 轮询间隔，避免单轮拖过一个 cadence；
 * 可用 FETCH_TIMEOUT_MS 覆盖，但不会超过 pollIntervalMs。
 */
export const FETCH_TIMEOUT_MS = Math.max(
  1000,
  Math.min(
    pollIntervalMs,
    Number(process.env.FETCH_TIMEOUT_MS || pollIntervalMs)
  )
)

export const dailyLookbackDays = Math.max(
  60,
  Number(process.env.DAILY_LOOKBACK_DAYS || 730)
)

export const goldApiToken = (process.env.GOLD_API_TOKEN || '').trim()

/**
 * USD/CNY 重拉间隔。默认 30 分钟；失败时沿用缓存，不阻断金价采价。
 */
export const fxRefreshIntervalMs = Math.max(
  60_000,
  Number(process.env.FX_REFRESH_INTERVAL_MS || 1_800_000)
)

/**
 * 休市时短睡间隔（禁止一次 setTimeout 睡到开盘）。
 * 默认 30s；可用 CLOSED_POLL_INTERVAL_MS 覆盖。
 */
export const closedPollIntervalMs = Math.max(
  5_000,
  Number(process.env.CLOSED_POLL_INTERVAL_MS || 30_000)
)
