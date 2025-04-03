import { $Enums } from '@prisma/texas-client'

import { clients } from '../..'
import router from '../instance'
import { record } from '../../models'
import { logger } from '../../logger'
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
    actionType: $Enums.Action
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
  const stage = texas.controller.stage
  await record.create({
    data: {
      action: 'bet',
      amount,
      stage,
      matchId,
      playerId: user.id
    }
  })

  const player = texas.dealer.find(
    (player) => player.getUserInfo().id === user.id
  )!
  try {
    player[actionType](amount)

    logger.info('向客户端推送player-take-actions事件')
    clients.forEach((client) => {
      client.send({
        type: 'player-take-action',
        data: {
          amount,
          actionType,
          userId: user.id,
          pool: texas.pool.totalAmount,
          balance: player.getBalance(),
          currentStageBetAmount: player.getCurrentStageTotalAmount()
        }
      })
    })
    response.success(ctx)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    response.error(ctx, 2000, error.message)
  }
})
