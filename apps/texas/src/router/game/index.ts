import { clients } from '../..'
import router from '../instance'
import { apiPrefix } from '../../config'
import { rooms } from '../../gameCenter'
import response from '../../utils/response'
import combinePath from '../../utils/combinePath'
import { match, matchStageTimeRecord } from '../../models'

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
    texas.start()
    // 需要创建对局信息
    const matchInfo = await match.create({
      data: {
        playersCount: texas.dealer.count
      }
    })
    // 轮到玩家行动时, 会触发回调
    texas.onPreAction(({ userId, restrict, allowedActions }) => {
      // TODO: 如果client不存在, 则表示掉线
      // 掉线后需要向其他玩家推送当前玩家的状态信息
      // 同时需要将Player的状态置为offline
      clients.get(userId)?.send({
        type: 'pre-action',
        data: {
          restrict,
          allowedActions,
          userId
        }
      })
      // 向其他玩家推送当前正在行动的玩家
      clients.forEach((ws, id) => {
        if (id !== userId)
          ws.send({
            type: 'player-active',
            data: {
              userId: id
            }
          })
      })
    })

    texas.onNextStage(async ({ stage, commonPokes, lastStage }) => {
      // 更新上一个阶段的结束时间
      await matchStageTimeRecord.update({
        where: {
          id: matchInfo.id,
          stage: lastStage
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
      clients.forEach((ws) => {
        ws.send({
          type: 'stage-change',
          data: {
            stage,
            commonPokes
          }
        })
      })
    })

    texas.onGameEnd(async ({ commonPokes, currentStage }) => {
      // 这里也需要更新matchStageTimeRecord表
      // 首先需要当前在哪个阶段
      // 然后需要设置当前阶段的结束时间
      // 如果是all-in直接推进到游戏结束
      // 那么游戏则视为只进行到当前所处的阶段
      await matchStageTimeRecord.update({
        where: {
          id: matchInfo.id,
          stage: currentStage
        },
        data: {
          endAt: new Date()
        }
      })
      clients.forEach((ws) => {
        ws.send({
          type: 'game-end',
          data: {
            commonPokes
            // settleList: Array.from(texas.pool.bills).map( ([userId, amount]) => {
            //   return {
            //     userId,
            //     amount,
            //     balance: texas.room.getPlayerById(userId)?.player.getUserInfo().balance
            //   }
            // })
          }
        })
      })
    })

    // 推送各个玩家的手牌信息
    clients.forEach((ws, userId) => {
      ws.send({
        type: 'game-start',
        data: {
          handPokes: texas.dealer
            .find((player) => player.getUserInfo().id === userId)
            ?.getHandPokes(),
          stage: texas.controller.stage,
          pool: texas.pool.totalAmount,
          matchId: matchInfo.id
        }
      })
    })
    response.success(ctx)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    response.error(ctx, 2000, error.message)
  }
})

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
    clients.forEach((ws) => {
      ws.send({
        type: 'game-ready',
        data: texas.dealer.map((player) => {
          return {
            userId: player.getUserInfo().id,
            role: player.getRole()
          }
        })
      })
    })
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
