import type { Context } from 'koa'

import { HTTP_STATUS } from '../constants/httpStatus'

export function withList(list: unknown[], total: number) {
  return { total, list }
}
export function success(ctx: Context, data: unknown = null, message = '成功') {
  ctx.status = HTTP_STATUS.OK
  ctx.body = {
    ok: true,
    data,
    message,
    traceId: (ctx.state as { traceId?: string } | undefined)?.traceId
  }
}
export function error(
  ctx: Context,
  status: number,
  message: string,
  details: unknown = null
) {
  ctx.status = status
  ctx.body = {
    ok: false,
    message,
    details,
    traceId: (ctx.state as { traceId?: string } | undefined)?.traceId
  }
}
// 统一封装response响应
const response = {
  error,
  success
}
export default response
