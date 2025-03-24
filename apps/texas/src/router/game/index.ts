import router from '../instance'
import { apiPrefix } from '../../config'
import { rooms } from '../../gameCenter'
import response from '../../utils/response'
import combinePath from '../../utils/combinePath'

const toolsApi = combinePath(apiPrefix)('/game')

router.post(toolsApi('/start/:roomId'), async (ctx) => {
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
    texas.start()

    const { commonPokes } = texas.dealer.getDeck().getPokes()
    const positions = texas.dealer.map((player) => {
      return {
        userId: player.getUserInfo().id,
        pokes: player.getHandPokes(),
        role: player.getRole()
      }
    })
    // const activePlayer = texas.controller.activePlayer
    const matchBaseInfo = {
      positions,
      commonPokes,
      totalPool: 0,
      stage: texas.controller.stage
      // activeUser: {
      //   id: activePlayer?.getUserInfo().id,
      //   allowedActions: activePlayer?.getAllowedActions(),
      //   betAmount: {
      //     min: 0,
      //     max: 0
      //   }
      // }
    }
    response.success(ctx, matchBaseInfo)
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
