import type { ApiResult } from '../../../utils/apiResult'

import { roomMember } from '../../../models'
import { gameRuntimeRegistry } from './runtimeRegistry'
import { HTTP_STATUS } from '../../../constants/httpStatus'

export type SubmitTopUpPlanInput = {
  userId: number
  roomId: number
  autoTopUpEnabled?: boolean
}

export type SubmitTopUpPlanData = {
  roomDefaultBuyIn: number
  autoTopUpEnabled: boolean
}

function fail(status: number, message: string): ApiResult<SubmitTopUpPlanData> {
  return { ok: false, status, message }
}

export class SubmitTopUpPlanUseCase {
  async execute(
    input: SubmitTopUpPlanInput
  ): Promise<ApiResult<SubmitTopUpPlanData>> {
    const { roomId, userId } = input
    if (!Number.isInteger(roomId)) {
      return fail(HTTP_STATUS.BAD_REQUEST, '参数异常：需要合法 roomId')
    }
    const membership = await roomMember.findFirst({
      where: { roomId, userId, room: { deletedAt: null } },
      select: { roomId: true }
    })
    if (!membership) return fail(HTTP_STATUS.FORBIDDEN, '不在该房间或未入座')

    const roomKey = String(roomId)
    const texas = gameRuntimeRegistry.getTexas(roomKey)
    if (!texas) return fail(HTTP_STATUS.NOT_FOUND, '对局运行时不可用')
    const runtime = gameRuntimeRegistry.getOrThrow(roomKey)
    const player = runtime.texas.dealer.find(
      (p) => p.getUserInfo().id === userId
    )
    if (!player) return fail(HTTP_STATUS.FORBIDDEN, '你不在该对局座位上')

    const roomDefaultBuyIn = Math.max(0, Number(runtime.roomInfo.initialChips))

    if (typeof input.autoTopUpEnabled === 'boolean') {
      gameRuntimeRegistry.setAutoTopUpEnabled(
        roomKey,
        userId,
        input.autoTopUpEnabled
      )
    }

    return {
      ok: true,
      data: {
        autoTopUpEnabled: gameRuntimeRegistry.isAutoTopUpEnabled(
          roomKey,
          userId
        ),
        roomDefaultBuyIn
      }
    }
  }
}
