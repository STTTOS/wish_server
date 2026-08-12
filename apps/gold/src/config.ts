export const port = process.env.SERVER_PORT || '7504'

export const apiPrefix = '/api'

export const OZ_TO_G = 31.1034768

export const FETCH_TIMEOUT_MS = 12_000

export const pollIntervalMs = Math.max(
  1000,
  Number(process.env.POLL_INTERVAL_MS || 5000)
)

export const dailyLookbackDays = Math.max(
  60,
  Number(process.env.DAILY_LOOKBACK_DAYS || 730)
)

export const goldApiToken = (process.env.GOLD_API_TOKEN || '').trim()
