import type { ApiResult } from '../../../utils/apiResult'

import { HTTP_STATUS } from '../../../constants/httpStatus'
import {
  ROOM_TABLE_TYPES,
  ROOM_PRESET_RULES,
  type RoomTableType,
  ROOM_LOWEST_BET_OPTIONS,
  ROOM_THINKING_TIME_OPTIONS,
  ROOM_CUSTOM_INITIAL_CHIPS_BB_MULTIPLIER_MAX,
  ROOM_CUSTOM_INITIAL_CHIPS_BB_MULTIPLIER_MIN
} from '../../../constants/game'

export type RoomCreateInput = {
  userId: number
  type: unknown
  lowestBetAmount: unknown
  isPrivate: unknown
  thinkingTime?: unknown
  initialChips?: unknown
  sevenTwoBonusEnabled?: unknown
}

export type RoomCreateAuthData = {
  userId: number
  tableType: RoomTableType
  lowestBetAmount: number
  thinkingTime: number
  isPrivate: boolean
  initialChips: number
  sevenTwoBonusEnabled: boolean
}

export type RoomCreateAuthResult = ApiResult<RoomCreateAuthData>

export function validateRoomCreateAuth(
  input: RoomCreateInput
): RoomCreateAuthResult {
  const {
    userId,
    type,
    lowestBetAmount,
    thinkingTime,
    isPrivate,
    initialChips,
    sevenTwoBonusEnabled
  } = input

  if (
    typeof type !== 'string' ||
    typeof lowestBetAmount !== 'number' ||
    typeof isPrivate !== 'boolean'
  ) {
    return { ok: false, status: HTTP_STATUS.BAD_REQUEST, message: '参数异常' }
  }

  if (!(ROOM_TABLE_TYPES as readonly string[]).includes(type)) {
    return {
      ok: false,
      status: HTTP_STATUS.BAD_REQUEST,
      message: '房间类型异常'
    }
  }
  const tableType = type as RoomTableType

  if (
    !Number.isInteger(lowestBetAmount) ||
    !(ROOM_LOWEST_BET_OPTIONS as readonly number[]).includes(lowestBetAmount)
  ) {
    return {
      ok: false,
      status: HTTP_STATUS.BAD_REQUEST,
      message: '盲注金额异常'
    }
  }

  if (tableType !== 'custom') {
    const presetRule = ROOM_PRESET_RULES[tableType]
    return {
      ok: true,
      data: {
        userId,
        tableType,
        lowestBetAmount,
        thinkingTime: presetRule.thinkingTime,
        isPrivate,
        initialChips: lowestBetAmount * presetRule.initialChipsBbMultiplier,
        sevenTwoBonusEnabled: false
      }
    }
  }

  if (
    typeof thinkingTime !== 'number' ||
    !Number.isInteger(thinkingTime) ||
    !(ROOM_THINKING_TIME_OPTIONS as readonly number[]).includes(thinkingTime)
  ) {
    return {
      ok: false,
      status: HTTP_STATUS.BAD_REQUEST,
      message: '思考时间异常'
    }
  }
  if (typeof initialChips !== 'number' || !Number.isInteger(initialChips)) {
    return {
      ok: false,
      status: HTTP_STATUS.BAD_REQUEST,
      message: '初始筹码必须为整数'
    }
  }
  const bbMultiplier = initialChips / lowestBetAmount
  if (
    !Number.isInteger(bbMultiplier) ||
    bbMultiplier < ROOM_CUSTOM_INITIAL_CHIPS_BB_MULTIPLIER_MIN ||
    bbMultiplier > ROOM_CUSTOM_INITIAL_CHIPS_BB_MULTIPLIER_MAX
  ) {
    return {
      ok: false,
      status: HTTP_STATUS.BAD_REQUEST,
      message: `自定义起始筹码必须是大盲注的整数倍，且在 ${ROOM_CUSTOM_INITIAL_CHIPS_BB_MULTIPLIER_MIN}~${ROOM_CUSTOM_INITIAL_CHIPS_BB_MULTIPLIER_MAX} BB 范围内`
    }
  }
  if (typeof sevenTwoBonusEnabled !== 'boolean') {
    return {
      ok: false,
      status: HTTP_STATUS.BAD_REQUEST,
      message: 'sevenTwoBonusEnabled 参数异常'
    }
  }

  return {
    ok: true,
    data: {
      userId,
      tableType,
      lowestBetAmount,
      thinkingTime,
      isPrivate,
      initialChips,
      sevenTwoBonusEnabled
    }
  }
}
