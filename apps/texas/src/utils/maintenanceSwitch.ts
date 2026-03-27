import { createClient, type RedisClientType } from 'redis'

import { logger } from '../logger'

const redisUrl = process.env.REDIS_URL
export const MAINTENANCE_KEY = 'texas:system:maintenance:enabled'

let redisClient: RedisClientType | null = null
let redisReady = false
let redisInitStarted = false

const ensureRedisReady = async () => {
  if (!redisUrl || redisReady) return

  if (!redisClient) {
    redisClient = createClient({ url: redisUrl })
    redisClient.on('error', (err) => {
      redisReady = false
      logger.error('redis maintenance client error', err)
    })
  }

  if (redisInitStarted) return
  redisInitStarted = true
  try {
    await redisClient.connect()
    redisReady = true
    logger.info('redis maintenance client connected')
  } catch (error) {
    redisReady = false
    logger.error('redis maintenance client connect failed', error)
  } finally {
    redisInitStarted = false
  }
}

const toBoolean = (value: string | null) => {
  if (!value) return false
  const normalized = value.trim().toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'on'
}

export const isMaintenanceEnabled = async () => {
  await ensureRedisReady()
  if (!redisReady || !redisClient) return false
  try {
    const flag = await redisClient.get(MAINTENANCE_KEY)
    return toBoolean(flag)
  } catch (error) {
    logger.error('redis get maintenance flag failed', error)
    return false
  }
}

export const setMaintenanceEnabled = async (enabled: boolean) => {
  await ensureRedisReady()
  if (!redisReady || !redisClient) return false
  try {
    await redisClient.set(MAINTENANCE_KEY, enabled ? '1' : '0')
    return true
  } catch (error) {
    logger.error('redis set maintenance flag failed', error)
    return false
  }
}
