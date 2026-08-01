import Koa from 'koa'
import { join } from 'path'
import cors from '@koa/cors'
import koaJwt from 'koa-jwt'
import mount from 'koa-mount'
import koaBody from 'koa-body'
import serve from 'koa-static'
import historyApiFallback from 'koa2-connect-history-api-fallback'

import router from './router'
import { logger } from './logger'
import response from './utils/response'
import { cacheTime as maxAge } from './config'
import requireAdmin from './middleware/requireAdmin'
import { HTTP_STATUS } from './constants/httpStatus'
import customHandle401 from './middleware/customHandle401'
import attachCurrentUser from './middleware/attachCurrentUser'
import { createTraceIdMiddleware } from './middleware/traceId'
import { createRequestLogMiddleware } from './middleware/requestLog'

/**
 * Factory Method：组装 Koa 应用（中间件顺序集中在此）。
 */
export function createApp() {
  const app = new Koa()

  app.use(createTraceIdMiddleware())
  app.use(async (ctx, next) => {
    try {
      await next()
    } catch (error) {
      response.error(ctx, HTTP_STATUS.INTERNAL_SERVER_ERROR, '系统异常')
      logger.error(error)
    }
  })
  app.use(createRequestLogMiddleware())

  // 配合 history 模式：放在静态资源前，未匹配文件的前端路由回退到 index.html
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
    if (ctx.path === '/public/index.html' || ctx.path === '/index.html') {
      ctx.set('Cache-Control', 'max-age=0')
    }
    await next()
  })

  app.use(mount('/', serve(join(__dirname, '../public'), { maxAge })))
  app.use(mount('/public', serve(join(__dirname, '../public'), { maxAge })))
  app.use(mount('/static', serve(join(__dirname, '../static'), { maxAge })))

  app.use(
    koaJwt({
      secret: process.env.SECRET_KEY!,
      cookie: 'token',
      passthrough: true
    })
  )

  app.use(customHandle401)
  app.use(attachCurrentUser)
  app.use(requireAdmin)

  app.use(
    koaBody({
      multipart: true,
      json: true,
      urlencoded: true,
      formidable: {
        uploadDir: join(__dirname, '../static'),
        keepExtensions: true,
        maxFileSize: 10 * 1024 * 1024
      }
    })
  )

  app.use(router.routes())
  return app
}
