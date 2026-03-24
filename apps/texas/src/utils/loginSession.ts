import dayjs from 'dayjs'
import { createClient, type RedisClientType } from 'redis'

import { logger } from '../logger'
import { timeFormat } from '../config'

export type LoginSession = {
  sessionId: string
  time: string
}

export type LoginScope = 'client' | 'web'

const loginUsersClient = new Map<number, LoginSession>()
const loginUsersWeb = new Map<number, LoginSession>()
const redisUrl = process.env.REDIS_URL
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60

let redisClient: RedisClientType | null = null
let redisReady = false
let redisInitStarted = false

const getStore = (scope: LoginScope) => {
  return scope === 'client' ? loginUsersClient : loginUsersWeb
}

const getSessionKey = (userId: number, scope: LoginScope) =>
  `texas:login:session:${scope}:${userId}`
// 只连一次、并发安全、失败可重试
const ensureRedisReady = async () => {
  if (!redisUrl || redisReady) return
  if (!redisClient) {
    redisClient = createClient({ url: redisUrl })
    redisClient.on('error', (err) => {
      redisReady = false
      logger.error('redis session client error', err)
    })
  }
  if (redisInitStarted) return

  redisInitStarted = true
  try {
    await redisClient.connect()
    redisReady = true
    logger.info('redis session client connected')
  } catch (error) {
    redisReady = false
    logger.error('redis session client connect failed', error)
  } finally {
    redisInitStarted = false
  }
}

export const setLoginSession = (
  userId: number,
  sessionId: string,
  scope: LoginScope
) => {
  const payload: LoginSession = {
    sessionId,
    time: dayjs().format(timeFormat)
  }
  getStore(scope).set(userId, payload)

  // fire-and-forget: redis 异常时保留内存兜底
  void (async () => {
    await ensureRedisReady()
    if (!redisReady || !redisClient) return
    await redisClient.set(
      getSessionKey(userId, scope),
      JSON.stringify(payload),
      { EX: SESSION_TTL_SECONDS }
    )
  })()
}

export const getLoginSession = async (userId: number, scope: LoginScope) => {
  await ensureRedisReady()
  if (redisReady && redisClient) {
    try {
      const raw = await redisClient.get(getSessionKey(userId, scope))
      if (!raw) return null
      const parsed = JSON.parse(raw) as LoginSession
      getStore(scope).set(userId, parsed)
      return parsed
    } catch (error) {
      logger.error('redis get login session failed', error)
    }
  }
  return getStore(scope).get(userId) ?? null
}

export const clearLoginSession = async (userId: number, scope: LoginScope) => {
  getStore(scope).delete(userId)
  await ensureRedisReady()
  if (!redisReady || !redisClient) return
  try {
    await redisClient.del(getSessionKey(userId, scope))
  } catch (error) {
    logger.error('redis clear login session failed', error)
  }
}
