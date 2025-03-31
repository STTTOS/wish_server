import { clients } from '../..'
import router from '../instance'
import { apiPrefix } from '../../config'
import { rooms } from '../../gameCenter'
import response from '../../utils/response'
import combinePath from '../../utils/combinePath'

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
  const target = texas.room.getPlayerById(userId)
  if (target?.player.getRole() !== 'button') {
    response.error(ctx, 2000, '不是庄家, 无法发牌')
    return
  }
  try {
    texas.start()

    // 轮到玩家行动时, 会触发回调
    texas.onPreAction(({ userId, restrict, allowedActions }) => {
      const wsRes = {
        type: 'pre-action',
        data: {
          restrict,
          allowedActions,
          userId
        }
      }
      // TODO: 如果client不存在, 则表示掉线
      // 掉线后需要向其他玩家推送当前玩家的状态信息
      // 同时需要将Player的状态置为offline
      clients.get(userId)?.send(JSON.stringify(wsRes))
      // 向其他玩家推送当前正在行动的玩家
      clients.forEach((client, id) => {
        if (id !== userId)
          client.send(
            JSON.stringify({
              type: 'player-active',
              data: {
                userId: id
              }
            })
          )
      })
    })

    texas.onNextStage(({ stage, commonPokes }) => {
      clients.forEach((client) => {
        const wsRes = {
          type: 'stage-change',
          data: {
            stage,
            commonPokes
          }
        }
        client.send(JSON.stringify(wsRes))
      })
    })

    texas.onGameEnd(({ commonPokes }) => {
      const wsRes = {
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
      }
      clients.forEach((client) => {
        client.send(JSON.stringify(wsRes))
      })
    })

    // 推送各个玩家的手牌信息
    clients.forEach((ws, userId) => {
      const wsRes = {
        type: 'game-start',
        data: {
          handPokes: texas.dealer
            .find((player) => player.getUserInfo().id === userId)
            ?.getHandPokes(),
          stage: texas.controller.stage,
          pool: texas.pool.totalAmount
        }
      }
      ws.send(JSON.stringify(wsRes))
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
    const wsRes = {
      type: 'game-ready',
      data: texas.dealer.map((player) => {
        return {
          userId: player.getUserInfo().id,
          role: player.getRole()
        }
      })
    }
    clients.forEach((ws) => {
      ws.send(JSON.stringify(wsRes))
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
