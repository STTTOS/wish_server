/* eslint-disable camelcase */
import { ActionWithPayload } from 'texas-poker-core'

import router from '../instance'
import { ws } from '../../server'
import { logger } from '../../logger'
import { apiPrefix } from '../../config'
import response from '../../utils/response'
import { rooms, Texas } from '../../gameCenter'
import combinePath from '../../utils/combinePath'
import {
  win,
  match,
  record,
  playerHand,
  matchStageTimeRecord
} from '../../models'

const toolsApi = combinePath(apiPrefix)('/game')

// 由庄家发牌
router.post(toolsApi('/start/:roomId'), async (ctx) => {
  const roomId = ctx.params.roomId
  const texas = rooms.get(roomId)
  if (!texas) {
    response.error(ctx, 2000, '房间不存在')
    return
  }
  const userId = ctx.state.user!.id
  const player = texas.room.getPlayerById(userId)!
  if (player.getRole() !== 'button') {
    response.error(ctx, 2000, '不是庄家, 无法发牌')
    return
  }
  try {
    // 轮到玩家行动时, 会触发回调
    texas.onPreAction(({ userId, restrict, allowedActions }) => {
      // TODO: 如果client不存在, 则表示掉线
      // 掉线后需要向其他玩家推送当前玩家的状态信息
      // 同时需要将Player的状态置为offline

      // // 向其他玩家推送当前正在行动的玩家
      logger.info('向客户端推送player-action事件')
      ws.broadcastTo(userId, {
        type: 'player-action',
        userInfo: {
          id: userId
        },
        restrict,
        allowedActions
      })
      ws.broadcastExcept(userId, {
        type: 'player-action',
        userInfo: {
          id: userId
        }
      })
    })

    texas.onGameStart(async () => {
      await matchStageTimeRecord.create({
        data: {
          stage: 'pre_flop',
          matchId: matchInfo.id
        }
      })
      logger.info('向客户端推送game-start事件')

      ws.broadcastEach((id) => {
        return {
          type: 'game-start',
          data: {
            matchId: matchInfo.id,
            // each player has different handPokes
            handPokes: texas.dealer
              .find((player) => player.id === id)
              ?.getHandPokes(),
            stage: texas.controller.stage,
            pool: texas.pool.totalAmount,
            defaultBets: texas.getDefaultBet().map(({ userId, amount }) => {
              return {
                amount,
                userInfo: texas.room.getPlayerById(userId)?.getUserInfo()
              }
            })
          }
        }
      })
      // 推送各个玩家的手牌信息
      // clients.forEach((ws, userId) => {
      //   ws.send({
      //     type: 'game-start',
      //     data: {
      //       handPokes: texas.dealer
      //         .find((player) => player.getUserInfo().id === userId)
      //         ?.getHandPokes(),
      //       stage: texas.controller.stage,
      //       pool: texas.pool.totalAmount,
      //       matchId: matchInfo.id,
      //       defaultBets: texas.getDefaultBet()
      //     }
      //   })
      // })
    })

    texas.onNextStage(async ({ stage, commonPokes, lastStage }) => {
      // 更新上一个阶段的结束时间
      await matchStageTimeRecord.update({
        where: {
          matchId_stage: {
            matchId: matchInfo.id,
            stage: lastStage
          }
        },
        data: {
          endAt: new Date()
        }
      })
      await matchStageTimeRecord.create({
        data: {
          stage,
          matchId: matchInfo.id
        }
      })
      logger.info('向客户端推送stage-change事件')
      ws.broadcast({
        type: 'stage-change',
        data: {
          stage,
          restCommonPokes: commonPokes
        }
      })
      // clients.forEach((ws) => {
      //   ws.send({
      //     type: 'stage-change',
      //     data: {
      //       stage,
      //       restCommonPokes: commonPokes
      //     }
      //   })
      // })
    })

    texas.onGameEnd(
      async ({ restCommonPokes, currentStage, showHandPokes }) => {
        // 这里也需要更新matchStageTimeRecord表
        // 首先需要当前在哪个阶段
        // 然后需要设置当前阶段的结束时间
        // 如果是all-in直接推进到游戏结束
        // 那么游戏则视为只进行到当前所处的阶段
        await texas.settle()
        await matchStageTimeRecord.update({
          where: {
            matchId_stage: {
              matchId: matchInfo.id,
              stage: currentStage
            }
          },
          data: {
            endAt: new Date()
          }
        })

        // 记录玩家手牌以及奖池分配情况
        const playerHands = texas.dealer.map((player) => {
          return {
            matchId: matchInfo.id,
            role: player.getRole(),
            hand: player.getHandPokes(),
            playerId: player.getUserInfo().id,
            earn: texas.pool.bills.get(player.id)
          }
        })
        await playerHand.createMany({
          data: playerHands
        })

        // 更新对局信息
        await match.update({
          where: {
            id: matchInfo.id
          },
          data: {
            endedAt: new Date(),
            endStage: texas.controller.endAt,
            totalBetAmount: texas.pool.totalAmount,
            // 最大牌型组合
            maximumPokes: texas.dealer.getMaxPokes(),
            // 最大牌力
            maximumType: texas.dealer.getMaxPresentation(),
            // 底牌
            commonPokes: texas.dealer.getDeck().getPokes().commonPokes
          }
        })

        // 记录玩家信息
        const winners = texas.dealer.getWinners()
        // 记录赢家信息
        await win.createMany({
          data: winners.map((winner) => {
            return {
              matchId: matchInfo.id,
              playerId: winner.getUserInfo().id
            }
          })
        })

        logger.info('向客户端推送game-end事件')

        const handPokes = (() => {
          if (showHandPokes)
            return texas.dealer.map((player) => {
              return {
                userInfo: {
                  id: player.getUserInfo().id
                },
                hand: player.getHandPokes()
              }
            })
          return []
        })()
        ws.broadcast({
          type: 'game-end',
          data: {
            handPokes,
            showHandPokes,
            restCommonPokes,
            settleList: Array.from(texas.pool.bills).map(([userId, amount]) => {
              const player = texas.room.getPlayerById(userId)

              return {
                amount,
                userInfo: player?.getUserInfo()
              }
            })
          }
        })
        // clients.forEach((ws) => {
        //   ws.send({
        //     type: 'game-end',
        //     data: {
        //       handPokes,
        //       showHandPokes,
        //       restCommonPokes,
        //       settleList: Array.from(texas.pool.bills).map(
        //         ([userId, amount]) => {
        //           const player = texas.room.getPlayerById(userId)

        //           return {
        //             amount,
        //             userInfo: player?.getUserInfo()
        //           }
        //         }
        //       )
        //     }
        //   })
        // })
        // 游戏结束后轮换角色
        texas.dealer.changeButtonToNextPlayer()
        texas.dealer.setOthers()
        texas.reset()
        broadCastRoles(texas)
      }
    )

    texas.onAction(async (player, isPreFlop) => {
      logger.info('向客户端推送player-take-action事件')

      const action = player.getAction() as ActionWithPayload
      // 默认下注行为不推送
      if (!isPreFlop)
        ws.broadcast({
          type: 'player-take-action',
          data: {
            actionType: action?.type,
            pool: texas.pool.totalAmount,
            userInfo: player.getUserInfo(),
            amount: action.payload?.value ?? 0,
            currentStageBetAmount: player.getCurrentStageTotalAmount()
          }
        })
      // clients.forEach((client) => {
      //   client.send({
      //     type: 'player-take-action',
      //     data: {
      //       actionType: action?.type,
      //       pool: texas.pool.totalAmount,
      //       amount: action.payload?.value ?? 0,
      //       currentStageBetAmount: player.getCurrentStageTotalAmount(),
      //       userInfo: player.getUserInfo()
      //     }
      //   })
      // })
      await record.create({
        data: {
          playerId: player.getUserInfo().id,
          stage: texas.controller.stage,
          action: action!.type,
          amount: action.payload?.value,
          matchId: matchInfo.id
        }
      })
    })
    // 需要创建对局信息
    const matchInfo = await match.create({
      data: {
        playersCount: texas.dealer.count,
        lowestBetAmount: texas.room.lowestBetAmount
      }
    })
    texas.start()

    response.success(ctx)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    response.error(ctx, 2000, error.message)
  }
})

export function broadCastRoles(texas: Texas) {
  logger.info('向客户端推送set-role事件')
  ws.broadcast({
    type: 'set-role',
    data: texas.dealer.map((player) => {
      return {
        userInfo: {
          id: player.getUserInfo().id
        },
        role: player.getRole()
      }
    })
  })
  // clients.forEach((ws) => {
  //   ws.send({
  //     type: 'set-role',
  //     data: texas.dealer.map((player) => {
  //       return {
  //         userInfo: {
  //           id: player.getUserInfo().id
  //         },
  //         role: player.getRole()
  //       }
  //     })
  //   })
  // })
}
// 房主开始游戏
// 确认各个玩家的角色
// 游戏一经开始, 不允许中途退出
// 如果强行退出app, 视为离线
// 当轮游戏结束后, 将离线的玩家踢出房间
// 如果在游戏进行中重新连接, 则回到房间中
router.post(toolsApi('/ready/:roomId'), async (ctx) => {
  const roomId = ctx.params.roomId
  const texas = rooms.get(roomId)
  if (!texas) {
    response.error(ctx, 2000, '房间不存在')
    return
  }
  const userId = ctx.state.user!.id
  if (texas.room.owner.getUserInfo().id !== userId) {
    response.error(ctx, 2000, '不是房主,无法开始游戏')
    return
  }
  try {
    texas.ready()
    response.success(ctx)
    broadCastRoles(texas)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    response.error(ctx, 2000, error.message)
  }
})

router.post(toolsApi('/end/:roomId'), async (ctx) => {
  const roomId = ctx.params.roomId
  if (!roomId) {
    response.error(ctx, 400, '参数错误')
    return
  }

  const texas = rooms.get(roomId)
  if (!texas) {
    response.error(ctx, 2000, '房间不存在')
    return
  }
  try {
    texas.end()
    response.success(ctx)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    response.error(ctx, 2000, error.message)
  }
})

router.post(toolsApi('/settle/:roomId'), async (ctx) => {
  const roomId = ctx.params.roomId

  try {
    const texas = rooms.get(roomId)
    if (!texas) {
      response.error(ctx, 2000, '房间不存在')
      return
    }
    await texas.settle()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    response.error(ctx, 2000, error.message)
  }
})
