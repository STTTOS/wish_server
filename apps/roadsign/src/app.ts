import Koa from 'koa'
import { join } from 'path'
import cors from '@koa/cors'
import mount from 'koa-mount'
import koaBody from 'koa-body'
import serve from 'koa-static'
import historyApiFallback from 'koa2-connect-history-api-fallback'

import router from './router'
import { logger } from './logger'
import { cacheTime } from './config'
import response from './utils/response'
import { HTTP_STATUS } from './constants/httpStatus'
import { mapPrismaError } from './utils/mapPrismaError'
import { requireApiToken } from './middleware/requireApiToken'
import { createTraceIdMiddleware } from './middleware/traceId'

export function createApp() {
  const app = new Koa()
  app.proxy = true

  app.use(createTraceIdMiddleware())
  app.use(async (ctx, next) => {
    try {
      await next()
    } catch (error) {
      const mapped = mapPrismaError(error)
      if (mapped) {
        response.error(ctx, mapped.status, mapped.message)
      } else {
        response.error(ctx, HTTP_STATUS.INTERNAL_SERVER_ERROR, '系统异常')
      }
      logger.error(error)
    }
  })

  // SPA：未匹配文件回退 index.html；API 白名单
  app.use(
    historyApiFallback({
      index: '/public/index.html',
      whiteList: ['^/api']
    })
  )

  app.use(
    cors({
      origin(ctx) {
        return ctx.get('Origin') || '*'
      },
      credentials: true
    })
  )

  app.use(async (ctx, next) => {
    await next()
    const path = ctx.path
    const isHtmlEntry =
      path === '/' ||
      path === '/index.html' ||
      path === '/public/index.html' ||
      (typeof ctx.type === 'string' && ctx.type.includes('html'))
    if (isHtmlEntry) {
      ctx.set('Cache-Control', 'no-store, no-cache, must-revalidate')
    }
  })

  app.use(
    mount('/', serve(join(__dirname, '../public'), { maxAge: cacheTime }))
  )
  app.use(
    mount('/public', serve(join(__dirname, '../public'), { maxAge: cacheTime }))
  )
  app.use(
    mount('/static', serve(join(__dirname, '../static'), { maxAge: cacheTime }))
  )

  app.use(
    koaBody({
      json: true,
      urlencoded: true
    })
  )
  app.use(requireApiToken)
  app.use(router.routes())
  app.use(router.allowedMethods())

  return app
}
