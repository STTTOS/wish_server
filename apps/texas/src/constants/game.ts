export const ROOM_TABLE_TYPES = ['quick', 'standard', 'deep', 'custom'] as const

export type RoomTableType = (typeof ROOM_TABLE_TYPES)[number]

export const ROOM_LOWEST_BET_OPTIONS = [40, 100, 200, 400, 1000] as const

export const ROOM_THINKING_TIME_OPTIONS = [10, 20, 30] as const

export const ROOM_CUSTOM_INITIAL_CHIPS_BB_MULTIPLIER_MIN = 50
export const ROOM_CUSTOM_INITIAL_CHIPS_BB_MULTIPLIER_MAX = 200

export const ROOM_PRESET_RULES: Record<
  Exclude<RoomTableType, 'custom'>,
  { initialChipsBbMultiplier: number; thinkingTime: number }
> = {
  quick: { initialChipsBbMultiplier: 50, thinkingTime: 10 },
  standard: { initialChipsBbMultiplier: 100, thinkingTime: 20 },
  deep: { initialChipsBbMultiplier: 200, thinkingTime: 30 }
}

export const CUSTOM_27O_REWARD_TIERS = [
  { minBbDepth: 150, rewardBb: 10 },
  { minBbDepth: 100, rewardBb: 8 },
  { minBbDepth: 50, rewardBb: 5 }
] as const

// 允许的最多玩家人数
export const MAX_PLAYERS_COUNT = 10

/** 上一人 action-taken 后，延迟多久推送下一位的 `player-action-required`（纯展示节奏；deadlineAt 仍按引擎触发时刻）。 */
export const GAME_WS_ACTION_REQUIRED_DELAY_MS = 1200

/**
 * Core `pendingFlowOps` 节拍：两次进街（含跑马连续翻牌）之间的间隔；摊牌结算后、推送 `game-end` 前亦用此时长。
 * `game-stage-changed` 在事件处理中立即推送，此值不推迟该 WS。
 */
export const GAME_WS_STAGE_CHANGED_DELAY_MS = 2200

/** 跑马二次协商：all-in 玩家投票窗口；超时默认否。 */
export const GAME_WS_RUNOUT_CONSENT_TIMEOUT_MS = 8000

/**
 * 二次跑马：第一跑河牌揭示后、第二跑 `boardReset` 推送前的停顿。
 * 可被 `gameRuntimeConfig.runoutInterRunDelayMs` 覆盖。
 */
export const GAME_WS_RUNOUT_INTER_RUN_DELAY_MS = 4000
