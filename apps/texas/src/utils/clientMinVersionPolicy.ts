import { createClient, type RedisClientType } from 'redis'

import { logger } from '../logger'
import { CLIENT_MIN_APP_VERSION_KEY } from '../constants/clientVersionConstants'

const redisUrl = process.env.REDIS_URL

let redisClient: RedisClientType | null = null
let redisReady = false
let redisInitStarted = false

/** 无 Redis 或未连接时的进程内回退（默认不拦截任何版本） */
let memoryMinVersion = '0.0.0'

const ensureRedisReady = async () => {
  if (!redisUrl || redisReady) return

  if (!redisClient) {
    redisClient = createClient({ url: redisUrl })
    redisClient.on('error', (err) => {
      redisReady = false
      logger.error('redis clientMinVersion client error', err)
    })
  }

  if (redisInitStarted) return
  redisInitStarted = true
  try {
    await redisClient.connect()
    redisReady = true
    logger.info('redis clientMinVersion client connected')
  } catch (error) {
    redisReady = false
    logger.error('redis clientMinVersion client connect failed', error)
  } finally {
    redisInitStarted = false
  }
}

export async function getMinClientAppVersion(): Promise<string> {
  await ensureRedisReady()
  if (!redisReady || !redisClient) {
    return memoryMinVersion
  }
  try {
    const v = await redisClient.get(CLIENT_MIN_APP_VERSION_KEY)
    if (v != null && v.trim() !== '') {
      memoryMinVersion = v.trim()
      return memoryMinVersion
    }
  } catch (error) {
    logger.error('redis get min app version failed', error)
  }
  return memoryMinVersion
}

export async function setMinClientAppVersion(
  version: string
): Promise<boolean> {
  memoryMinVersion = version.trim()
  await ensureRedisReady()
  if (!redisReady || !redisClient) {
    logger.warn(
      '[clientMinVersion] REDIS_URL 未配置或 Redis 不可用，最低版本仅保存在进程内存'
    )
    return true
  }
  try {
    await redisClient.set(CLIENT_MIN_APP_VERSION_KEY, memoryMinVersion)
    return true
  } catch (error) {
    logger.error('redis set min app version failed', error)
    return false
  }
}

export function getMinClientAppVersionMemoryFallback(): string {
  return memoryMinVersion
}
