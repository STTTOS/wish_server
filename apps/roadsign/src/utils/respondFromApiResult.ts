import type { Context } from 'koa'
import type { ApiResult } from './apiResult'

import response from './response'

export function respondFromApiResult<T>(
  ctx: Context,
  result: ApiResult<T>,
  options?: {
    okMessage?: string
    okData?: unknown
    failDetails?: unknown
  }
) {
  if (result.ok) {
    response.success(
      ctx,
      options?.okData ?? result.data ?? null,
      options?.okMessage ?? '成功'
    )
    return
  }

  response.error(
    ctx,
    result.status,
    result.message,
    options?.failDetails ?? result.details ?? null
  )
}
