import Koa from 'koa'
import { join } from 'path'
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
import authenticateMiddleware from './middleware/authenticate'
import requireAuthMiddleware from './middleware/requireAuthMiddleware'
import errorHandlerMiddleware from './middleware/errorHandlerMiddleware'

const app = new Koa()

//统一错误处理
app.use(errorHandlerMiddleware)

// 解析用户信息, 并改在到context中间件
app.use(
  authenticateMiddleware({
    secret: process.env.SECRET_KEY!
  })
)
// 权限校验中间件, 确保后续要用到`context.userInfo`信息的路由能拿到信息, 否则进行401/403跳转
app.use(requireAuthMiddleware)

app.use(loggerMiddleware)

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
