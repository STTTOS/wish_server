import type { ApiResult } from '../../../utils/apiResult'

import { roomMember } from '../../../models'
import { gameRuntimeRegistry } from './runtimeRegistry'
import { HTTP_STATUS } from '../../../constants/httpStatus'
import { getNextHandCountdownSnapshot } from '../../../gameRuntime/nextHandCountdown'

export const MIN_TARGET_BB = 50
export const MAX_TARGET_BB = 200

export type SubmitTopUpPlanInput = {
  userId: number
  roomId: number
  targetBalance?: number | null
  autoTopUpEnabled?: boolean
}

export type SubmitTopUpPlanData = {
  roomDefaultBuyIn: number
  targetBalance: number | null
  autoTopUpEnabled: boolean
  bigBlind: number
  suggestThresholdMin: number
  suggestThresholdMax: number
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
    const roomDefaultBuyIn = Math.max(0, Number(runtime.roomInfo.initialChips))
    if (!Number.isFinite(bb) || bb <= 0) {
      return fail(HTTP_STATUS.CONFLICT, '房间盲注配置异常')
    }
    const balance = Math.round(player.balance)
    const minTargetBalance = Math.max(balance, MIN_TARGET_BB * bb)
    const maxTargetBalance = MAX_TARGET_BB * bb
    const canSubmit = this.#canSubmit(
      roomId,
      runtime.texas.controller.status,
      player,
      bb
    )

    if (typeof input.autoTopUpEnabled === 'boolean') {
      gameRuntimeRegistry.setAutoTopUpEnabled(
        roomKey,
        userId,
        input.autoTopUpEnabled
      )
    }

    if (input.targetBalance === undefined) {
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
          roomDefaultBuyIn,
          bigBlind: bb,
          suggestThresholdMin: roomDefaultBuyIn * 0.2,
          suggestThresholdMax: roomDefaultBuyIn * 0.4,
          minTargetBalance,
          maxTargetBalance,
          canSubmit
        }
      }
    }

    if (!canSubmit) {
      return fail(HTTP_STATUS.CONFLICT, '当前时机不可提交补码申请')
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
        roomDefaultBuyIn,
        bigBlind: bb,
        suggestThresholdMin: roomDefaultBuyIn * 0.2,
        suggestThresholdMax: roomDefaultBuyIn * 0.4,
        minTargetBalance,
        maxTargetBalance,
        canSubmit
      }
    }
  }

  #canSubmit(
    roomId: number,
    handLifecycle: unknown,
    player: { getStatus: () => string; balance: number },
    bb: number
  ): boolean {
    const status = String(handLifecycle)
    const balance = Math.round(player.balance)
    if (balance >= MAX_TARGET_BB * bb) return false

    if (status === 'in_hand') {
      return player.getStatus() === 'out'
    }
    if (status !== 'between_hands') return false

    const countdown = getNextHandCountdownSnapshot(roomId)
    if (countdown.state === 'push_delay_scheduled') return true
    if (countdown.state === 'active') return Date.now() < countdown.lockAt
    return false
  }
}
