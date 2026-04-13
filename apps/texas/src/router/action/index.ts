import { ActionType, TexasError, isFatalTexasErrorCode } from 'texas-poker-core'

import router from '../instance'
import { apiPrefixWeb } from '../../config'
import response from '../../utils/response'
import combinePath from '../../utils/combinePath'
import { HTTP_STATUS } from '../../constants/httpStatus'
import { gameRuntimeRegistry } from '../game/services/runtimeKit'
import { actionToTableCommand } from '../game/services/texasDomain/actionToTableCommand'
import { drainAndInterpretTexas } from '../game/services/texasDomain/drainTexasDomainEvents'
import { getTexasEventContextForRoom } from '../game/services/texasDomain/texasEventContext'
import { handleFatalTexasEngineError } from '../game/services/texasDomain/handleFatalTexasEngineError'

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
    response.error(ctx, HTTP_STATUS.BAD_REQUEST, '参数异常')
    return
  }
  const user = ctx.state.user!
  const texas = gameRuntimeRegistry.getTexas(roomId)

  if (!texas) {
    response.error(ctx, HTTP_STATUS.NOT_FOUND, '房间不存在')
    return
  }
  const numericRoomId = Number(roomId)
  if (!Number.isInteger(numericRoomId)) {
    response.error(ctx, HTTP_STATUS.BAD_REQUEST, '参数异常')
    return
  }

  try {
    await texas.dispatchCommand(
      actionToTableCommand(user.id, actionType, amount)
    )
    await drainAndInterpretTexas(getTexasEventContextForRoom(roomId))
    response.success(ctx)
  } catch (e: unknown) {
    if (e instanceof TexasError && isFatalTexasErrorCode(e.code)) {
      await handleFatalTexasEngineError({
        error: e,
        roomId: numericRoomId,
        roomKey: roomId,
        getRuntime: () => gameRuntimeRegistry.getOrThrow(roomId)
      })
    }
    const message = e instanceof Error ? e.message : '行动失败'
    response.error(ctx, HTTP_STATUS.CONFLICT, message)
  }
})
