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
