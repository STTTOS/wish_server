/* eslint-disable no-console */
import type { BizError } from './router/interface'

import Koa from 'koa'
import http from 'http'
import WebSocket from 'ws'
import { join } from 'path'
import cors from '@koa/cors'
import koaJwt from 'koa-jwt'
import qs from 'querystring'
import koaBody from 'koa-body'

import router from './router'
import { port } from './config'
import { logger } from './logger'
import response from './utils/response'
import customHandle401 from './middleware/customHandle401'
import loggerMiddleware from './middleware/loggerMiddleware'

export const app = new Koa()

const server = http.createServer(app.callback())
export const wss = new WebSocket.Server({ server, path: '/ws' })
// WebSocket 连接事件

export const clients = new Map<number, WebSocket>()

// 只有当玩家加入房间时, 才开启ws连接
// 退出房间时, 需要关闭连接
wss.on('connection', async (ws, req) => {
  logger.info('新的客户端连接')

  // 从查询参数中获取用户ID
  const params = qs.parse(req.url?.split('?')[1] || '')
  const [userId, roomId] = [Number(params.userId), params.roomId as string]
  if (!userId || !roomId) {
    // 如果连接无法建立, 则需要告知客户端连接出现异常
    // 提示客户端参数异常, 无法加入房间
    logger.error('参数错误导致连接关闭')
    ws.close(1007, '参数错误,连接关闭')
    return
  }
  // 将用户ID与连接关联
  clients.set(userId, ws)
  ws.send(JSON.stringify({ type: 'initial connect', data: null }))
  // 向客户端发送欢迎消息
  // ws.readyState === WebSocket.OPEN

  // 处理连接关闭
  ws.on('close', () => {
    // 玩家离开房间, 玩家离线等
    // 需要向其他客户端推送消息
    clients.delete(userId)
    logger.info('客户端断开连接')
  })

  // 处理错误
  ws.on('error', (error) => {
    // 连接出现异常, 则无法正常加入房间
    clients.delete(userId)
    logger.error('WebSocket 错误:', error)
  })
})

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

server.listen(port, () => {
  logger.info('server startup', `http://localhost:${port}`)
})
