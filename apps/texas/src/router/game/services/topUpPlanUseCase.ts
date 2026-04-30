import type { ApiResult } from '../../../utils/apiResult'

import { roomMember } from '../../../models'
import { gameRuntimeRegistry } from './runtimeRegistry'
import { HTTP_STATUS } from '../../../constants/httpStatus'

const MIN_TARGET_BB = 50
const MAX_TARGET_BB = 200

export type SubmitTopUpPlanInput = {
  userId: number
  roomId: number
  targetBalance: number | null
  autoTopUpEnabled?: boolean
}

export type SubmitTopUpPlanData = {
  targetBalance: number | null
  autoTopUpEnabled: boolean
  bigBlind: number
  minTargetBalance: number
  maxTargetBalance: number
  canSubmit: boolean
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

    const bb = Number(runtime.roomInfo.lowestBetAmount)
    if (!Number.isFinite(bb) || bb <= 0) {
      return fail(HTTP_STATUS.CONFLICT, '房间盲注配置异常')
    }
    const balance = Math.round(player.balance)
    const minTargetBalance = Math.max(balance, MIN_TARGET_BB * bb)
    const maxTargetBalance = MAX_TARGET_BB * bb
    const canSubmit = this.#canSubmit(
      runtime.texas.controller.status,
      player,
      bb
    )
    if (!canSubmit) {
      return fail(HTTP_STATUS.CONFLICT, '当前时机不可提交补码申请')
    }

    if (typeof input.autoTopUpEnabled === 'boolean') {
      gameRuntimeRegistry.setAutoTopUpEnabled(
        roomKey,
        userId,
        input.autoTopUpEnabled
      )
    }

    if (input.targetBalance == null) {
      gameRuntimeRegistry.clearPendingTopUpTarget(roomKey, userId)
    } else {
      const target = Math.trunc(input.targetBalance)
      if (target < minTargetBalance || target > maxTargetBalance) {
        return fail(
          HTTP_STATUS.BAD_REQUEST,
          `补码目标超出范围：${minTargetBalance}~${maxTargetBalance}`
        )
      }
      if ((target - minTargetBalance) % bb !== 0) {
        return fail(HTTP_STATUS.BAD_REQUEST, `补码步长需为 ${bb}`)
      }
      gameRuntimeRegistry.setPendingTopUpTarget(roomKey, userId, target)
    }

    return {
      ok: true,
      data: {
        targetBalance: gameRuntimeRegistry.getPendingTopUpTarget(
          roomKey,
          userId
        ),
        autoTopUpEnabled: gameRuntimeRegistry.isAutoTopUpEnabled(
          roomKey,
          userId
        ),
        bigBlind: bb,
        minTargetBalance,
        maxTargetBalance,
        canSubmit
      }
    }
  }

  #canSubmit(
    handLifecycle: unknown,
    player: { getStatus: () => string; balance: number },
    bb: number
  ): boolean {
    const status = String(handLifecycle)
    if (status === 'idle' || status === 'between_hands') return true
    if (Math.round(player.balance) < MAX_TARGET_BB * bb) return true
    return player.getStatus() === 'out'
  }
}
