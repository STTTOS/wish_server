import type { BizError } from './router/interface'

import Koa from 'koa'
import { join } from 'path'
import cors from '@koa/cors'
import koaJwt from 'koa-jwt'
import koaBody from 'koa-body'

import router from './router'
import { port } from './config'
import { logger } from './logger'
import response from './utils/response'
import customHandle401 from './middleware/customHandle401'
import loggerMiddleware from './middleware/loggerMiddleware'

const app = new Koa()
//统一错误处理
app.use(async (ctx, next) => {
  try {
    await next()
  } catch (err) {
    const { status = 500 } = err as BizError

    // eslint-disable-next-line no-console
    logger.error(err)
    response.error(ctx, status, '系统异常')
  }
})

app.use(async (ctx, next) => {
  const { ip, url } = ctx.request
  logger.info(`ip: ${ip}, request for ${url}`)
  await next()
})
// 请求跨域
app.use(cors())

app.use(
  koaJwt({
    secret: process.env.SECRET_KEY!,
    cookie: 'token',
    // 继续移交给下一个中间件
    // 由`customHandle401`决定如何处理无登录态
    passthrough: true
  })
)
// Custom 401 handling
app.use(customHandle401)

// 解析请求体
app.use(
  koaBody({
    // 支持文件格式
    multipart: true,
    formidable: {
      // 保留文件扩展名
      keepExtensions: true,
      // 上传目录
      uploadDir: join(__dirname, '../static')
    }
  })
)
app.use(loggerMiddleware)
//路由中间件
app.use(router.routes())

app.listen(port, () => {
  logger.info('server startup', `http://localhost:${port}`)
})
