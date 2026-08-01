/* eslint-disable no-console */
import Koa from 'koa'
import crypto from 'crypto'
import { join } from 'path'
import cors from '@koa/cors'
import koaJwt from 'koa-jwt'
import mount from 'koa-mount'
import koaBody from 'koa-body'
import serve from 'koa-static'

import router from './router'
import { logger } from './logger'
import response from './utils/response'
import { port, cacheTime as maxAge } from './config'
import requireAdmin from './middleware/requireAdmin'
import { HTTP_STATUS } from './constants/httpStatus'
import customHandle401 from './middleware/customHandle401'
import attachCurrentUser from './middleware/attachCurrentUser'
import { ensureDefaultCategory } from './services/ensureDefaultCategory'

const app = new Koa()

app.use(async (ctx, next) => {
  const traceId = crypto.randomUUID()
  ;(ctx.state as { traceId?: string }).traceId = traceId
  ctx.set('x-trace-id', traceId)
  await next()
})

app.use(async (ctx, next) => {
  try {
    await next()
  } catch (error) {
    response.error(ctx, HTTP_STATUS.INTERNAL_SERVER_ERROR, '系统异常')
    logger.error(error)
  }
})

app.use(async (ctx, next) => {
  const { ip, url } = ctx.request
  logger.info(`ip: ${ip}, request for ${url}`)
  await next()
})

app.use(
  cors({
    origin(ctx) {
      return ctx.get('Origin') || '*'
    },
    credentials: true
  })
)

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

async function bootstrap() {
  if (!process.env.SECRET_KEY) {
    throw new Error('SECRET_KEY is required')
  }
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required')
  }

  await ensureDefaultCategory()

  app.listen(port, () => {
    logger.info('mart server startup', `http://localhost:${port}`)
  })
}

bootstrap().catch((error) => {
  logger.error(error)
  process.exit(1)
})
