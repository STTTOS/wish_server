import type { Context } from 'koa'

import { apiPrefixClient } from '../config'

/**
 * 从 query / body 读取客户端上报的 App version（与 clientAppVersionGuard 约定一致）。
 */
export function readClientVersionFromRequest(ctx: Context): string | undefined {
  const method = ctx.method.toUpperCase()
  let raw: unknown
  if (method === 'GET') {
    raw = ctx.query.version
  } else {
    const body = ctx.request.body
    if (body && typeof body === 'object' && !Array.isArray(body)) {
      raw = (body as Record<string, unknown>).version
    }
  }
  if (typeof raw === 'string' && raw.trim() !== '') return raw.trim()
  if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw)
  return undefined
}

/**
 * API 日志用 version：仅 `/api/client` 记录客户端版本，其余（含 web）固定为 `-`。
 */
export function readClientVersionForApiLog(ctx: Context): string {
  if (
    !ctx.path.startsWith(`${apiPrefixClient}/`) &&
    ctx.path !== apiPrefixClient
  ) {
    return '-'
  }
  return readClientVersionFromRequest(ctx) ?? '-'
}
