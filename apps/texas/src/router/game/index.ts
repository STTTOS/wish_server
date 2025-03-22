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
  texas.start()
  // texas.controller.onActive = (player: Player) => {

  // }

  const { commonPokes } = texas.dealer.getDeck().getPokes()
  const handPokes = texas.dealer.map((player) => {
    return {
      userId: player.getUserInfo().id,
      pokes: player.getHandPokes()
    }
  })
  const activePlayer = texas.controller.activePlayer
  const matchBaseInfo = {
    handPokes,
    commonPokes,
    totalPool: 0,
    stage: texas.controller.stage,
    activeUser: {
      id: activePlayer?.getUserInfo().id,
      allowedActions: activePlayer?.getAllowedActions(),
      betAmount: {
        min: 0,
        max: 0
      }
    }
  }
  response.success(ctx, matchBaseInfo)
})
