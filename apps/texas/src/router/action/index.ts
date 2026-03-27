import { ActionType } from 'texas-poker-core'

import router from '../instance'
import { apiPrefixWeb } from '../../config'
import response from '../../utils/response'
import combinePath from '../../utils/combinePath'
import { ERROR_CODE } from '../../constants/errorCodes'
import { gameRuntimeRegistry } from '../game/services/runtimeKit'

const toolsApi = combinePath(apiPrefixWeb)('/action')

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
    response.error(ctx, ERROR_CODE.BAD_REQUEST, '参数异常')
    return
  }
  const user = ctx.state.user!
  const texas = gameRuntimeRegistry.getTexas(roomId)

  if (!texas) {
    response.error(ctx, ERROR_CODE.COMMON_FAIL, '房间不存在')
    return
  }
  const player = texas.dealer.find(
    (player) => player.getUserInfo().id === user.id
  )!
  await player[actionType](amount)
  response.success(ctx)
})
