import type { ActionType } from 'texas-poker-core'
import type { ApiVoidResult } from '../../../utils/apiResult'

import { roomMember } from '../../../models'
import { gameRuntimeRegistry } from './runtimeRegistry'
import { HTTP_STATUS } from '../../../constants/httpStatus'

type TakeActionInput = {
  userId: number
  actionType: ActionType
  amount: number
}

/**
 * 客户端行动用例：
 * - 当前轮到本人：执行动作
 * - 非当前回合：仅当「玩家最近动作」与本次请求（type + amount）一致时按重试幂等成功
 * - 其余非当前回合请求：返回 409，避免把新意图误判为成功
 */
export class TakeActionUseCase {
  async execute(input: TakeActionInput): Promise<ApiVoidResult> {
    const { userId, actionType, amount } = input
    if (!actionType || !Number.isFinite(amount) || amount < 0) {
      return { ok: false, status: HTTP_STATUS.BAD_REQUEST, message: '参数异常' }
    }

    const membership = await roomMember.findFirst({
      where: { userId, room: { deletedAt: null } },
      select: { roomId: true }
    })
    const roomId = membership?.roomId
    if (!roomId) {
      return {
        ok: false,
        status: HTTP_STATUS.CONFLICT,
        message: '当前不在对局房间中'
      }
    }

    const roomKey = String(roomId)
    const texas = gameRuntimeRegistry.getTexas(roomKey)
    if (!texas) {
      return { ok: false, status: HTTP_STATUS.NOT_FOUND, message: '对局不存在' }
    }

    const player = texas.dealer.find((p) => p.getUserInfo().id === userId)
    if (!player) {
      return {
        ok: false,
        status: HTTP_STATUS.FORBIDDEN,
        message: '你不在该对局中'
      }
    }

    const activePlayerId = texas.controller.activePlayer?.getUserInfo().id
    if (activePlayerId !== userId) {
      const lastAction = player.getAction()
      const lastAmount = Number(lastAction?.payload?.value ?? 0)
      const isIdempotentRetry =
        Boolean(lastAction) &&
        lastAction!.type === actionType &&
        lastAmount === amount
      if (isIdempotentRetry) return { ok: true, data: null }

      return {
        ok: false,
        status: HTTP_STATUS.CONFLICT,
        message: '当前不是你的行动回合'
      }
    }

    try {
      await player[actionType](amount)
      return { ok: true, data: null }
    } catch (e) {
      const message = e instanceof Error ? e.message : '行动失败'
      return { ok: false, status: HTTP_STATUS.CONFLICT, message }
    }
  }
}
