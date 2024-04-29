import Koa from 'koa'
import { join } from 'path'
import Cookie from 'cookie'
import mount from 'koa-mount'
import serve from 'koa-static'
import koaBody from 'koa-body'
import jwt from 'jsonwebtoken'
import { toLower } from 'ramda'
import { historyApiFallback } from 'koa2-connect-history-api-fallback'

import './tasks'
import './scripts'
import router from './router'
import { user } from './models'
import { logger } from './logger'
import response from './utils/response'
import { port, apiNeededToAuth, cacheTime as maxAge } from './config'

const app = new Koa()

//统一错误处理
app.use(async (ctx, next) => {
  try {
    await next()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    logger.error(err.stack || err.message)
    ctx.status = 500
    response.error(ctx, 500, err.message || '系统异常')
  }
})
function verifyJwt(token = '') {
  try {
    const decoded = jwt.verify(token, process.env.SECRET_KEY!) as unknown as {
      id: number
      role: string
    }
    return { error: null, data: decoded }
  } catch (error) {
    return {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      error: (error as any).name as 'TokenExpiredError',
      data: null
    }
  }
}
// 用户信息处理
// 1. 将用户信息解析出来并挂在ctx上
// 2. 如果是需要权限的接口, 需要鉴权并返回403
app.use(async (ctx, next) => {
  const { data, error } = verifyJwt(
    Cookie.parse(ctx.request.header.cookie || '').token
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ctx.userInfo = data || ({} as any)

  if (
    apiNeededToAuth.some((url) => toLower(url) === toLower(ctx.request.url))
  ) {
    if (error) {
      response.error(
        ctx,
        401,
        error === 'TokenExpiredError' ? 'token过期' : 'token无效'
      )
    } else {
      const target = await user.findUnique({ where: { id: data?.id } })
      if (target?.role !== 'admin') {
        response.error(ctx, 403, '无权限, 禁止访问')
      } else {
        await next()
      }
    }
  } else {
    await next()
  }
})

app.use(async (ctx, next) => {
  const { url } = ctx.request
  const ip = ctx.headers['x-real-ip'] || ctx.request.ip

  logger.info(`ip: ${ip}, request for ${url}`)
  await next()
})
// 配合history模式
// 放在静态资源服务中间件前面加载
// 404  重定向到 /public/index.html
app.use(historyApiFallback({ index: '/index.html' }))

// 访问 网站静态文件
app.use(serve(join(__dirname, '../public'), { maxAge }))

// 注册静态资源前缀 /static
app.use(mount('/static', serve(join(__dirname, '../static'), { maxAge })))

// 解析请求体
app.use(koaBody())

//路由中间件
app.use(router.routes())

app.listen(port, () => {
  logger.info('server startup', `http://localhost:${port}`)
})
