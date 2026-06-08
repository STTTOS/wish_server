import Koa from 'koa'
import { join } from 'path'
import koaJwt from 'koa-jwt'
import cors from '@koa/cors'
import mount from 'koa-mount'
import serve from 'koa-static'
import koaBody from 'koa-body'
import { historyApiFallback } from 'koa2-connect-history-api-fallback'

import './tasks'
import './scripts'
import router from '@/router'
import { logger } from '@/logger'
import { port, cacheTime as maxAge } from './config'
import customHandle401 from './middleware/customHandle401'
import loggerMiddleware from './middleware/loggerMiddleware'
import requireAuthMiddleware from './middleware/requireAuthMiddleware'
import errorHandlerMiddleware from './middleware/errorHandlerMiddleware'

// eslint-disable-next-line @typescript-eslint/no-var-requires

const app = new Koa()

//统一错误处理
app.use(errorHandlerMiddleware)

// 配合history模式
// 放在静态资源服务中间件前面加载
// 404  重定向到 /public/index.html
app.use(historyApiFallback({ index: '/public/index.html' }))

app.use(
  cors({
    origin(ctx) {
      return ctx.get('Origin') || '*'
    }
  })
)
// 访问网站静态文件
app.use(async (ctx, next) => {
  if (ctx.path === '/public/index.html' || ctx.path === '/index.html') {
    // 不缓存 index.html
    ctx.set('Cache-Control', 'max-age=0')
  }
  await next()
})

// 访问 网站静态文件
app.use(mount('/', serve(join(__dirname, '../public'), { maxAge })))

// 访问 网站静态文件
app.use(mount('/public', serve(join(__dirname, '../public'), { maxAge })))

// 注册静态资源前缀 /static
app.use(mount('/static', serve(join(__dirname, '../static'), { maxAge })))

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

// 请求日志尽早挂载，避免被 requireAuth 提前 return 时漏记
app.use(loggerMiddleware)

// JSON / urlencoded 全局解析；multipart 仅由路由级 koaBody 处理，避免重复解析
app.use(
  koaBody({
    multipart: false,
    json: true,
    urlencoded: true
  })
)

// 权限校验中间件, 非管理员403跳转
app.use(requireAuthMiddleware)

//路由中间件
app.use(router.routes())

app.listen(port, () => {
  logger.info('server startup', `http://localhost:${port}`)
})
