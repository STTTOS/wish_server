import Koa from 'koa'
import cors from '@koa/cors'
import koaBody from 'koa-body'

import router from './router'
import { logger } from './logger'
import response from './utils/response'
import { HTTP_STATUS } from './constants/httpStatus'
import { requireApiToken } from './middleware/requireApiToken'

export function createApp() {
  const app = new Koa()
  app.proxy = true

  app.use(async (ctx, next) => {
    try {
      await next()
    } catch (error) {
      response.error(ctx, HTTP_STATUS.INTERNAL_SERVER_ERROR, '系统异常')
      logger.error(error)
    }
  })

  app.use(
    cors({
      origin(ctx) {
        return ctx.get('Origin') || '*'
      },
      credentials: true
    })
  )

  app.use(koaBody({ json: true, urlencoded: true }))
  app.use(requireApiToken)
  app.use(router.routes())
  app.use(router.allowedMethods())

  return app
}
