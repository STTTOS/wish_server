import Koa from 'koa'
import { join } from 'path'
import koaJwt from 'koa-jwt'
import mount from 'koa-mount'
import serve from 'koa-static'
import koaBody from 'koa-body'
import { historyApiFallback } from 'koa2-connect-history-api-fallback'

import './tasks'
import './scripts'
import router from './router'
import { logger } from './logger'
import { port, cacheTime as maxAge } from './config'
import loggerMiddleware from './middleware/loggerMiddleware'
import requireAuthMiddleware from './middleware/requireAuthMiddleware'
import errorHandlerMiddleware from './middleware/errorHandlerMiddleware'

const app = new Koa()

//统一错误处理
app.use(errorHandlerMiddleware)

// 配合history模式
// 放在静态资源服务中间件前面加载
// 404  重定向到 /public/index.html
app.use(historyApiFallback({ index: '/public/index.html' }))

// 访问 网站静态文件
app.use(mount('/public', serve(join(__dirname, '../public'), { maxAge })))

// 注册静态资源前缀 /static
app.use(mount('/static', serve(join(__dirname, '../static'), { maxAge })))

app.use(
  koaJwt({ secret: process.env.SECRET_KEY, cookie: 'token' }).unless({
    // 排除一些不需要401跳转的接口
    path: [
      /^\/static/,
      /^\/public/,
      /^\/api\/user\/(logout|signin|recommend|all|card)/,
      /^\/api\/article\/(detail|similar|count|clientList|visibleUsers)/,
      '/api/tag/all',
      '/api/tag/view/platform',
      '/api/tag/view/personal',
      '/api/comment/list',
      '/api/common/webViewCount'
    ]
  })
)
// 权限校验中间件, 非管理员403跳转
app.use(requireAuthMiddleware)

app.use(loggerMiddleware)

// 解析请求体
app.use(koaBody())

//路由中间件
app.use(router.routes())

app.listen(port, () => {
  logger.info('server startup', `http://localhost:${port}`)
})
