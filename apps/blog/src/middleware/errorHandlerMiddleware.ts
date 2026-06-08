import { Context } from 'koa'

import { logger } from '../logger'
import response from '@/utils/response'

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return '系统异常'
}

const loggerMiddleware = async (ctx: Context, next: () => Promise<void>) => {
  try {
    await next()
  } catch (error) {
    const err = error as { httpCode?: number }
    if (err.httpCode === 413) {
      response.error(ctx, 413, getErrorMessage(error))
    } else {
      response.error(ctx, 500, '系统异常')
    }
    logger.error(error)
  }
}
export default loggerMiddleware
