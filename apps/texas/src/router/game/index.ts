/* eslint-disable camelcase */
import { Texas } from 'texas-poker-core'

import router from '../instance'
import { ws } from '../../server'
import { logger } from '../../logger'
import { apiPrefix } from '../../config'
import response from '../../utils/response'
import combinePath from '../../utils/combinePath'
import { rooms, getRoomId } from '../../gameCenter'
import {
  match,
  betRecord,
  matchError,
  userRoomStat,
  playerMatchRecord,
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
  // 轮到玩家行动时, 会触发回调
  texas.onPreAction(({ userId, restrict, allowedActions }) => {
    // TODO: 如果client不存在, 则表示掉线
    // 掉线后需要向其他玩家推送当前玩家的状态信息
    // 同时需要将Player的状态置为offline

    // // 向其他玩家推送当前正在行动的玩家
    logger.info('向客户端推送player-action事件')
    ws.broadcastTo(userId, {
      type: 'player-action',
      data: {
        userInfo: {
          id: userId
        },
        restrict,
        allowedActions
      }
    })
    ws.broadcastExcept(roomId, userId, {
      type: 'player-action',
      data: {
        userInfo: {
          id: userId
        }
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

    ws.broadcastEach(roomId, (id) => {
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
    ws.broadcast(roomId, {
      type: 'stage-change',
      data: {
        stage,
        restCommonPokes: commonPokes
      }
    })
  })

  texas.onGameEnd(async ({ restCommonPokes, currentStage, showHandPokes }) => {
    // 这时候游戏状态为end
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
    const playerHands = texas.dealer.map((player) => ({
      matchId: matchInfo.id,
      role: player.getRole(),
      hand: player.getHandPokes(),
      playerId: player.getUserInfo().id,
      earn: texas.pool.bills.get(player.id),
      presentation: texas.dealer.getMaxPresentation(),
      totalBetAmount: texas.pool.totalAmount
    }))
    await playerMatchRecord.createMany({ data: playerHands })

    // 更新用户在房间内的对局统计
    await Promise.all(
      texas.dealer.map((player) => {
        const userId = player.getUserInfo().id
        const wager = texas.pool.bills.get(player.id) ?? 0

        return userRoomStat.upsert({
          where: {
            userId_roomId: {
              userId,
              roomId: matchInfo.roomId
            }
          },
          update: {
            matchCount: {
              increment: 1
            },
            lastMatchAt: new Date(),
            totalWager: {
              increment: wager
            }
          },
          create: {
            userId,
            roomId: matchInfo.roomId,
            matchCount: 1,
            lastMatchAt: new Date(),
            totalWager: wager
          }
        })
      })
    )

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
        commonPokes: texas.dealer.deck.getPokes().commonPokes
      }
    })

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
    logger.info('向客户端推送game-end事件')
    ws.broadcast(roomId, {
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

    // 游戏结束后轮换角色
    texas.dealer.changeButtonToNextPlayer()
    texas.dealer.setOthers()
    broadCastRoles(roomId, texas)

    // 重置对局信息
    // 这时候游戏状态为waiting
    texas.reset()
  })

  texas.onAction(async (player, isPreFlop) => {
    const action = player.getAction()
    // 默认下注行为不推送
    if (!isPreFlop) {
      logger.info('向客户端推送player-take-action事件')
      ws.broadcast(roomId, {
        type: 'player-take-action',
        data: {
          actionType: action?.type,
          pool: texas.pool.totalAmount,
          userInfo: player.getUserInfo(),
          amount: action?.payload?.value ?? 0,
          currentStageBetAmount: player.currentStageTotalAmount
        }
      })
    }

    await betRecord.create({
      data: {
        playerId: player.getUserInfo().id,
        stage: texas.controller.stage,
        action: action!.type,
        amount: action?.payload?.value,
        matchId: matchInfo.id
      }
    })
  })

  texas.onError(async (error) => {
    await matchError.create({
      data: {
        matchId: matchInfo.id,
        info: error.stack || `${error.name}: ${error.message}`
      }
    })
  })
  // 需要创建对局信息
  const matchInfo = await match.create({
    data: {
      playersCount: texas.dealer.count,
      lowestBetAmount: texas.room.lowestBetAmount,
      roomId: Number(roomId)
    }
  })
  await texas.start()
  response.success(ctx, { matchId: matchInfo.id })
})

export function broadCastRoles(roomId: string, texas: Texas) {
  logger.info('向客户端推送set-role事件')
  // const roomId = texas.room
  ws.broadcast(roomId, {
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
  texas.ready()
  response.success(ctx)
  broadCastRoles(roomId, texas)
})

// 手动结束游戏进程
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
  texas.end()
  response.success(ctx)
})

router.post(toolsApi('/settle/:roomId'), async (ctx) => {
  const roomId = ctx.params.roomId

  const texas = rooms.get(roomId)
  if (!texas) {
    response.error(ctx, 2000, '房间不存在')
    return
  }
  await texas.settle()
})

// 用户重连后获取当前对局的状态
router.post(toolsApi('/fetchCurrentGameState'), async (ctx) => {
  const userId = ctx.state.user!.id
  const roomId = getRoomId(userId)
  let texas: Texas | undefined
  if (!roomId || !(texas = rooms.get(roomId))) {
    response.success(ctx, 2100, '对局不存在')
    return
  }

  const gameStatus = texas.controller.status
  if (gameStatus !== 'on') {
    response.success(ctx, 2100, '游戏已经结束')
    return
  }
  // 需要获取当前对局的信息
  // 包括所有玩家的信息
  // 当前行动的用户的相关信息
  // 当前的阶段, 总奖池

  // 所有玩家的信息
  const playersOnSeat = texas.room
    .getPlayersBySeatStatus('on-set')
    .map((player) => {
      return {
        role: player.getRole(),
        action: player.getAction(),
        userInfo: player.getUserInfo(),
        currentStageTotalAmount: player.currentStageTotalAmount
      }
    })
  const playersOnWatch = texas.room
    .getPlayersBySeatStatus('hang')
    .map((player) => {
      return {
        userInfo: player.getUserInfo()
      }
    })

  const activePlayer = texas.controller.activePlayer
  // 当前行动玩家的信息
  const activePlayerInfo = {
    userInfo: activePlayer?.getUserInfo(),
    remainThinkTime: activePlayer?.getRemainThinkTime()
  }

  // 对局信息
  const matchInfo = {
    status: gameStatus,
    stage: texas.controller.stage,
    pool: texas.pool.totalAmount
  }
  response.success(ctx, {
    playersOnSeat,
    playersOnWatch,
    matchInfo,
    activePlayerInfo
  })
})
