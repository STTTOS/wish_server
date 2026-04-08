import type { ApiResult } from '../../../utils/apiResult'

import { MIN_BB } from '../../../constants/game'
import { HTTP_STATUS } from '../../../constants/httpStatus'
import { gameRuntimeConfig } from '../../../utils/gameRuntimeConfig'

export type RoomCreateInput = {
  userId: number
  lowestBetAmount: unknown
  thinkingTime: unknown
  isPrivate: unknown
  initialChips: unknown
}

export type RoomCreateAuthData = {
  userId: number
  lowestBetAmount: number
  thinkingTime: number
  isPrivate: boolean
  initialChips: number
}

export type RoomCreateAuthResult = ApiResult<RoomCreateAuthData>

export function validateRoomCreateAuth(
  input: RoomCreateInput
): RoomCreateAuthResult {
  const { userId, lowestBetAmount, thinkingTime, isPrivate, initialChips } =
    input

  if (
    typeof lowestBetAmount !== 'number' ||
    typeof thinkingTime !== 'number' ||
    typeof isPrivate !== 'boolean' ||
    typeof initialChips !== 'number'
  ) {
    return { ok: false, status: HTTP_STATUS.BAD_REQUEST, message: '参数异常' }
  }

  if (thinkingTime < gameRuntimeConfig.getMinThinkingTime()) {
    return {
      ok: false,
      status: HTTP_STATUS.BAD_REQUEST,
      message: `思考时间不可小于${gameRuntimeConfig.getMinThinkingTime()}s`
    }
  }

  if (!Number.isInteger(lowestBetAmount) || lowestBetAmount < MIN_BB) {
    return {
      ok: false,
      status: HTTP_STATUS.BAD_REQUEST,
      message: '盲注金额异常'
    }
  }

  if (
    !Number.isInteger(initialChips) ||
    initialChips <
      lowestBetAmount * gameRuntimeConfig.getInitialChipsMinBigBlindMultiplier()
  ) {
    return {
      ok: false,
      status: HTTP_STATUS.BAD_REQUEST,
      message: `初始筹码必须为整数且大于等于大盲注的${gameRuntimeConfig.getInitialChipsMinBigBlindMultiplier()}倍`
    }
  }

  return {
    ok: true,
    data: {
      userId,
      lowestBetAmount,
      thinkingTime,
      isPrivate,
      initialChips
    }
  }
}
