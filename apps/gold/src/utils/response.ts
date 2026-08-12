import type { Context } from 'koa'

import { HTTP_STATUS } from '../constants/httpStatus'

export function success(ctx: Context, data: unknown = null, message = '成功') {
  ctx.status = HTTP_STATUS.OK
  ctx.body = {
    ok: true,
    data,
    message
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
    details
  }
}

const response = { error, success }

export default response
