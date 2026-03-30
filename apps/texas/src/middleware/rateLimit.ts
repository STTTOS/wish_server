import type { ParameterizedContext } from 'koa'

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
  // 默认保护所有 API
  pattern: /^\/api\//,
  windowMs: 1000,
  max: 20
}

const RULES: LimitRule[] = [
  // 登录类接口更严格，防撞库
  {
    pattern: /^\/api\/client\/user\/sign$/,
    windowMs: 60_000,
    max: 20
  },
  {
    pattern: /^\/api\/web\/user\/login$/,
    windowMs: 60_000,
    max: 20
  },
  // 公告已读类接口短时高频保护
  {
    pattern: /^\/api\/client\/announcement\/markRead/,
    windowMs: 1000,
    max: 8
  }
]

const buckets = new Map<string, Bucket>()

const pickRule = (path: string): LimitRule => {
  const matched = RULES.find((rule) => rule.pattern.test(path))
  return matched ?? DEFAULT_RULE
}

const buildKey = (ctx: ParameterizedContext<DefaultState>) => {
  const identity =
    ctx.state.user?.id != null ? `uid:${ctx.state.user.id}` : `ip:${ctx.ip}`
  return `${ctx.method}:${ctx.path}:${identity}`
}

// 简单固定窗口限流：默认在单实例内存中生效
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
