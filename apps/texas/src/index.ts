/* eslint-disable camelcase */

/* eslint-disable no-console */
import type { BizError } from './router/interface'

import Koa from 'koa'
import http from 'http'
import { join } from 'path'
import cors from '@koa/cors'
import koaJwt from 'koa-jwt'
import koaBody from 'koa-body'
import { Server, Socket } from 'socket.io'

import router from './router'
import { port } from './config'
import { logger } from './logger'
import response from './utils/response'
import customHandle401 from './middleware/customHandle401'
import loggerMiddleware from './middleware/loggerMiddleware'

// import { ActionWithPayload, initialGame } from 'texas-poker-core'
// import { match, matchStageTimeRecord, playerHand, record, win } from './models'

export const app = new Koa()

const server = http.createServer(app.callback())
const io = new Server(server, {
  cors: { origin: 'https://texas.wishufree.com' }
  // cors: { origin: '*' }
})

export const clients = new Map<number, Socket>()

// 使用 middleware 验证连接参数
io.use((socket, next) => {
  const queryParams = socket.handshake.query
  const [userId, roomId] = [
    Number(queryParams.userId),
    queryParams.roomId as string
  ]
  // 验证参数
  if (!userId || !roomId) {
    // 传递错误，拒绝连接
    logger.error(`ws连接url:${socket.handshake.url}(参数异常), 拒绝连接`)
    return next(new Error('无效的连接参数, 拒绝连接'))
  }

  // 允许连接
  next()
})
// 只有当玩家加入房间时, 才开启ws连接
// 退出房间时, 需要关闭连接
io.on('connection', (socket) => {
  logger.info('新的客户端连接, url', socket.handshake.url)

  const queryParams = socket.handshake.query
  const [userId] = [Number(queryParams.userId), queryParams.roomId as string]

  // 将用户ID与连接关联
  clients.set(userId, socket)
  socket.send({ type: 'initial connect', data: null })
  // 向客户端发送欢迎消息
  // ws.readyState === WebSocket.OPEN

  // 处理连接关闭
  socket.on('disconnect', (reason) => {
    // 玩家离开房间, 玩家离线等
    // 需要向其他客户端推送消息
    clients.delete(userId)
    logger.info('客户端断开连接, id:', socket.id, '原因', reason)
  })

  // 处理错误
  socket.on('error', (error) => {
    // 连接出现异常, 则无法正常加入房间
    clients.delete(userId)
    console.error('连接错误:', error)
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

server.listen(port, async () => {
  logger.info('server startup', `http://localhost:${port}`)

  // const texas = initialGame({
  //   maximumCountOfPlayers: 3,
  //   allowPlayersToWatch: true,
  //   thinkingTime: 5,
  //   user: { id: 1, balance: 10000, name: 'xuan' },
  //   lowestBetAmount: 100
  // })
  // const p1 = texas.room.owner
  // const p2 = texas.createPlayer({ id: 2, balance: 12000, name: 'yt' })
  // texas.room.join(p2)

  // // 需要创建对局信息
  // const matchInfo = await match.create({
  //   data: {
  //     playersCount: texas.dealer.count
  //   }
  // })
  // console.log('matchId', matchInfo.id)
  // await matchStageTimeRecord.create({
  //   data: {
  //     stage: 'pre_flop',
  //     matchId: matchInfo.id
  //   }
  // })
  // texas.onNextStage(async ({ stage, commonPokes, lastStage }) => {
  //   console.log('next-stage', stage, lastStage, matchInfo.id)
  //   // 更新上一个阶段的结束时间
  //   await matchStageTimeRecord.update({
  //     where: {
  //       matchId_stage: {
  //         matchId: matchInfo.id,
  //         stage: lastStage
  //       }
  //     },
  //     data: {
  //       endAt: new Date()
  //     }
  //   })
  //   await matchStageTimeRecord.create({
  //     data: {
  //       stage,
  //       matchId: matchInfo.id
  //     }
  //   })
  // })

  // texas.onGameEnd(
  //   async ({ restCommonPokes, currentStage, showHandPokes }) => {
  //     console.log('game-end', 'match id', matchInfo.id, currentStage)
  //     // 这里也需要更新matchStageTimeRecord表
  //     // 首先需要当前在哪个阶段
  //     // 然后需要设置当前阶段的结束时间
  //     // 如果是all-in直接推进到游戏结束
  //     // 那么游戏则视为只进行到当前所处的阶段
  //     await texas.settle()
  //     await matchStageTimeRecord.update({
  //       where: {
  //         matchId_stage: {
  //           matchId: matchInfo.id,
  //           stage: currentStage
  //         }
  //       },
  //       data: {
  //         endAt: new Date()
  //       }
  //     })
  //     await match.update({
  //       where: {
  //         id: matchInfo.id
  //       },
  //       data: {
  //         endedAt: new Date(),
  //         endStage: texas.controller.endAt,
  //         totalBetAmount: texas.pool.totalAmount,
  //         // 最大牌型组合
  //         maximumPokes: texas.dealer.getMaxPokes(),
  //         // 最大牌力
  //         maximumType: texas.dealer.getMaxPresentation(),
  //         // 底牌
  //         commonPokes: texas.dealer.getDeck().getPokes().commonPokes
  //       }
  //     })

  //     const winners = texas.dealer.getWinners()
  //     // 记录赢家信息
  //     await win.createMany({
  //       data: winners.map((winner) => {
  //         return {
  //           matchId: matchInfo.id,
  //           playerId: winner.getUserInfo().id
  //         }
  //       })
  //     })
  //   }
  // )
  // texas.onAction(async (player) => {
  //   await record.create({
  //     data: {
  //       playerId: player.getUserInfo().id,
  //       stage: texas.controller.stage,
  //       action: player.getAction()!.type,
  //       amount: (player.getAction() as ActionWithPayload)?.payload?.value,
  //       matchId: matchInfo.id
  //     }
  //   })
  //   console.log('record create')
  // })
  // texas.ready()
  // // texas.start()
  // texas.dealer.setButton(p2)
  // texas.dealer.setOthers()
  // texas.dealer.dealCards()

  // await playerHand.createMany({
  //   data: texas.dealer.map((player) => {
  //     return {
  //       hand: player.getHandPokes(),
  //       playerId: player.getUserInfo().id,
  //       matchId: matchInfo.id
  //     }
  //   })
  // })
  // texas.controller.transferControlToNext(p1)
  // p1.bet(100)
  // p2.call()

  // await delay(1000)
  // p1.bet(200)
  // p2.raise(500)
  // p1.call()

  // await delay(1000)
  // p1.bet(300)
  // p2.call()

  // await delay(1000)
  // p1.bet(500)
  // p2.call()
})

// const delay = (ms : number) => {
//   return new Promise((resolve) => {
//     setTimeout(() => {
//       resolve(0)
//     }, ms)
//   })
// }
