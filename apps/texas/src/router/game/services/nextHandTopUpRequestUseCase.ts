import type { ApiResult } from '../../../utils/apiResult'

import { roomMember } from '../../../models'
import { gameRuntimeRegistry } from './runtimeRegistry'
import { HTTP_STATUS } from '../../../constants/httpStatus'

export type NextHandTopUpRequestInput = {
  userId: number
  roomId: number
}

export type NextHandTopUpRequestData = {
  roomDefaultBuyIn: number
  autoTopUpEnabled: boolean
}

function fail(
  status: number,
  message: string
): ApiResult<NextHandTopUpRequestData> {
  return { ok: false, status, message }
}

/**
 * 预约下一手 `onLock` 补至起始筹码（与自动补码叠加；幂等：重复请求仍为成功）。
 */
export class NextHandTopUpRequestUseCase {
  async execute(
    input: NextHandTopUpRequestInput
  ): Promise<ApiResult<NextHandTopUpRequestData>> {
    const { roomId, userId } = input
    if (!Number.isInteger(roomId)) {
      return fail(HTTP_STATUS.BAD_REQUEST, '参数异常：需要合法 roomId')
    }

    const membership = await roomMember.findFirst({
      where: { roomId, userId, room: { deletedAt: null } },
      select: { roomId: true }
    })
    if (!membership) {
      return fail(HTTP_STATUS.FORBIDDEN, '不在该房间或未入座')
    }

    const roomKey = String(roomId)
    const texas = gameRuntimeRegistry.getTexas(roomKey)
    if (!texas) {
      return fail(HTTP_STATUS.NOT_FOUND, '对局运行时不可用')
    }

    const runtime = gameRuntimeRegistry.getOrThrow(roomKey)
    const player = runtime.texas.dealer.find(
      (p) => p.getUserInfo().id === userId
    )
    if (!player) {
      return fail(HTTP_STATUS.FORBIDDEN, '你不在该对局座位上')
    }

    if (gameRuntimeRegistry.hasQueuedLeave(roomKey, userId)) {
      return fail(HTTP_STATUS.CONFLICT, '本手已标记离场，无法预约补码')
    }

    const roomDefaultBuyIn = Math.max(0, Number(runtime.roomInfo.initialChips))
    if (roomDefaultBuyIn <= 0) {
      return fail(HTTP_STATUS.CONFLICT, '房间未配置起始筹码')
    }

    const balance = Math.round(player.balance)
    if (balance >= roomDefaultBuyIn) {
      return fail(HTTP_STATUS.CONFLICT, '当前筹码不低于起始筹码，无需补码')
    }

    gameRuntimeRegistry.requestNextHandManualTopUp(roomKey, userId)

    return {
      ok: true,
      data: {
        roomDefaultBuyIn,
        autoTopUpEnabled: gameRuntimeRegistry.isAutoTopUpEnabled(
          roomKey,
          userId
        )
      }
    }
  }
}
