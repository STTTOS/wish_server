// 允许的最小思考时间
export const MIN_THINKING_TIME = 5

// 允许的最大思考时间
export const MAX_THINKING_TIME = 60

// 初始筹码必须大于大盲注的倍数
export const INITIAL_CHIPS_MIN_BB_MULTIPLIER = 50

// 默认初始筹码大盲注倍数
export const DEFAULT_INITIAL_CHIPS_MIN_BB_MULTIPLIER = 100

// 最小大盲注
export const MIN_BB = 2

// 允许的最多玩家人数
export const MAX_PLAYERS_COUNT = 10

/** 上一人 action-taken 后，延迟多久推送下一位的 `player-action-required`（纯展示节奏；deadlineAt 仍按引擎触发时刻）。 */
export const GAME_WS_ACTION_REQUIRED_DELAY_MS = 1000

/**
 * Core `pendingFlowOps` 节拍：两次进街（含跑马连续翻牌）之间的间隔；摊牌结算后、推送 `game-end` 前亦用此时长。
 * `game-stage-changed` 在事件处理中立即推送，此值不推迟该 WS。
 */
export const GAME_WS_STAGE_CHANGED_DELAY_MS = 2000
