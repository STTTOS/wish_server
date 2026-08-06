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
import { cacheTime as maxAge, UPLOAD_MAX_FILE_SIZE_MB } from './config'
import { HTTP_STATUS } from './constants/httpStatus'
import { mapPrismaError } from './utils/mapPrismaError'
import customHandle401 from './middleware/customHandle401'
import attachCurrentUser from './middleware/attachCurrentUser'
import rateLimit from './middleware/rateLimit'
import { createTraceIdMiddleware } from './middleware/traceId'
import { createRequestLogMiddleware } from './middleware/requestLog'
import { memoryFileWriteStreamHandler } from './utils/memoryUpload'

/**
 * Factory Method：组装 Koa 应用（中间件顺序集中在此）。
 */
export function createApp() {
  const app = new Koa()
  // nginx 已设 X-Real-IP / X-Forwarded-For，限流与日志需要真实客户端 IP
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

  // 静态资源可长缓存；HTML 入口必须在静态中间件之后覆盖 Cache-Control，
  // 否则 koa-static 的 maxAge 会盖掉前置设置，导致旧 SPA 路由被浏览器缓存。
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
  // 限流放在解析 multipart 之前，避免刷上传时先落盘再拒绝
  app.use(rateLimit)

  app.use(
    koaBody({
      multipart: true,
      json: true,
      urlencoded: true,
      formidable: {
        // 公开上传走内存 buffer，不写 static/
        maxFileSize: UPLOAD_MAX_FILE_SIZE_MB * 1024 * 1024,
        keepExtensions: true,
        fileWriteStreamHandler: memoryFileWriteStreamHandler
      } as koaBody.IKoaBodyFormidableOptions
    })
  )

  app.use(router.routes())
  return app
}
