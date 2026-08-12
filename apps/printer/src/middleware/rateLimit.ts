import type { ParameterizedContext } from 'koa'

import {
  PUBLIC_UPLOAD_RATE_MAX,
  PUBLIC_UPLOAD_TOKEN_RATE_MAX
} from '../config'
import response from '../utils/response'
import { DefaultState } from '../router/instance'
import { HTTP_STATUS } from '../constants/httpStatus'

type LimitRule = {
  pattern: RegExp
  windowMs: number
  max: number
}

type Bucket = {
  count: number
  resetAt: number
}

const DEFAULT_RULE: LimitRule = {
  pattern: /^\/api\//,
  windowMs: 1000,
  max: 20
}

const RULES: LimitRule[] = [
  {
    pattern: /^\/api\/public\/upload-token$/,
    windowMs: 60_000,
    max: PUBLIC_UPLOAD_TOKEN_RATE_MAX
  },
  {
    pattern: /^\/api\/public\/upload$/,
    windowMs: 60_000,
    max: PUBLIC_UPLOAD_RATE_MAX
  },
  {
    pattern: /^\/api\/auth\/login$/,
    windowMs: 60_000,
    max: 20
  }
]

const buckets = new Map<string, Bucket>()

const pickRule = (path: string): LimitRule => {
  const matched = RULES.find((rule) => rule.pattern.test(path))
  return matched ?? DEFAULT_RULE
}

const clientIp = (ctx: ParameterizedContext<DefaultState>) => {
  const realIp = ctx.get('x-real-ip')
  if (realIp) return realIp.trim()
  return ctx.ip
}

const buildKey = (ctx: ParameterizedContext<DefaultState>) => {
  const identity =
    ctx.state.user?.id != null ? `uid:${ctx.state.user.id}` : `ip:${clientIp(ctx)}`
  return `${ctx.method}:${ctx.path}:${identity}`
}

/** 简单固定窗口限流（单实例内存），对齐 texas 防机器刷接口做法 */
export default async (
  ctx: ParameterizedContext<DefaultState>,
  next: () => Promise<void>
) => {
  const { path } = ctx
  if (!path.startsWith('/api/')) {
    await next()
    return
  }

  const rule = pickRule(path)
  const key = buildKey(ctx)
  const now = Date.now()
  const oldBucket = buckets.get(key)

  if (!oldBucket || now >= oldBucket.resetAt) {
    buckets.set(key, {
      count: 1,
      resetAt: now + rule.windowMs
    })
    await next()
    return
  }

  if (oldBucket.count >= rule.max) {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((oldBucket.resetAt - now) / 1000)
    )
    ctx.set('Retry-After', String(retryAfterSeconds))
    response.error(
      ctx,
      HTTP_STATUS.TOO_MANY_REQUESTS,
      `请求过于频繁，请 ${retryAfterSeconds} 秒后重试`
    )
    return
  }

  oldBucket.count += 1
  buckets.set(key, oldBucket)
  await next()
}
