import { $Enums } from '@prisma/texas-client'

import router from '../instance'
import { record } from '../../models'
import { apiPrefix } from '../../config'
import { rooms } from '../../gameCenter'
import response from '../../utils/response'
import combinePath from '../../utils/combinePath'

const toolsApi = combinePath(apiPrefix)('/action')

router.post(toolsApi('/bet'), async (ctx) => {
  const {
    amount,
    stage,
    matchId,
    roomId
  }: {
    matchId: number
    action: $Enums.Action
    stage: $Enums.Stage
    amount?: number
    roomId: string
  } = ctx.request.body
  const user = ctx.state.user!
  if (!amount || amount <= 0) {
    response.error(ctx, 400, '下注金额不可为0')
    return
  }
  if (!matchId || !roomId) {
    response.error(ctx, 400, '参数异常')
    return
  }
  await record.create({
    data: {
      action: 'bet',
      amount,
      stage,
      matchId,
      playerId: user.id
    }
  })
  const texas = rooms.get(roomId)?.texas
  // TODO: 特殊的错误码, 并告知客户端中止游戏, 并回滚
  if (!texas) throw new Error('游戏异常')

  const player = texas.dealer.find(
    (player) => player.getUserInfo().id === user.id
  )!
  player.bet(amount)
  response.success(ctx, null, '用户行为')
})
