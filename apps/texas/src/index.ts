/* eslint-disable camelcase */

/* eslint-disable no-console */
import { join } from 'path'
import cors from '@koa/cors'
import koaJwt from 'koa-jwt'
import mount from 'koa-mount'
import koaBody from 'koa-body'
import serve from 'koa-static'
import { TexasError } from 'texas-poker-core'
import historyApiFallback from 'koa2-connect-history-api-fallback'

import router from './router'
import { logger } from './logger'
import { app, server } from './server'
import response from './utils/response'
import { port, cacheTime as maxAge } from './config'
import customHandle401 from './middleware/customHandle401'
import customHandle403 from './middleware/customHandle403'
import loggerMiddleware from './middleware/loggerMiddleware'

// import { ActionWithPayload, initialGame } from 'texas-poker-core'
// import { match, matchStageTimeRecord, playerHand, record, win } from './models'

//统一错误处理
app.use(async (ctx, next) => {
  try {
    await next()
  } catch (error) {
    if (error instanceof TexasError) {
      response.error(ctx, error.code, error.message)
    } else {
      response.error(ctx, 500, '系统异常')
    }
    logger.error(error)
  }
})

// 记录请求
app.use(async (ctx, next) => {
  const { ip, url } = ctx.request
  logger.info(`ip: ${ip}, request for ${url}`)
  await next()
})

// 配合history模式
// 放在静态资源服务中间件前面加载
// 404  重定向到 /public/index.html
app.use(
  historyApiFallback({
    index: '/public/index.html',
    whiteList: ['/api/client/game/config']
  })
)

// 跨域设置
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

// Custom 403 handling (admin-only apis)
app.use(customHandle403)

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
