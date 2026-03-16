import { ActionType } from 'texas-poker-core'

import router from '../instance'
import { apiPrefix } from '../../config'
import { rooms } from '../../gameCenter'
import response from '../../utils/response'
import combinePath from '../../utils/combinePath'

const toolsApi = combinePath(apiPrefix)('/action')

router.post(toolsApi('/take'), async (ctx) => {
  const {
    amount = 0,
    matchId,
    roomId,
    actionType
  }: {
    matchId: number
    amount?: number
    roomId: string
    actionType: ActionType
  } = ctx.request.body
  if (!matchId || !roomId || !actionType) {
    response.error(ctx, 400, '参数异常')
    return
  }
  const user = ctx.state.user!
  const texas = rooms.get(roomId)

  if (!texas) {
    response.error(ctx, 2000, '房间不存在')
    return
  }
  const player = texas.dealer.find(
    (player) => player.getUserInfo().id === user.id
  )!
  await player[actionType](amount)
  response.success(ctx)
})
