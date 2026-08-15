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
