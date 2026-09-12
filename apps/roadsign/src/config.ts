export const port = process.env.SERVER_PORT || '7505'

export const apiPrefix = '/api'

export const cacheTime = 30 * 24 * 60 * 60

export const roadsignApiToken = (process.env.ROADSIGN_API_TOKEN || '').trim()
