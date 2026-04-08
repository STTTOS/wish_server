// 允许的最小思考时间
export const MIN_THINKING_TIME = 5

// 允许的最大思考时间
export const MAX_THINKING_TIME = 60

// 初始筹码必须大于大盲注的倍数
export const INITIAL_CHIPS_MIN_BB_MULTIPLIER = 30

// 默认初始筹码大盲注倍数
export const DEFAULT_INITIAL_CHIPS_MIN_BB_MULTIPLIER = 50

// 最小大盲注
export const MIN_BB = 2

// 允许的最多玩家人数
export const MAX_PLAYERS_COUNT = 10

/** 上一人 action-taken 后，延迟多久推送下一位的 `player-action-required`（纯展示节奏；deadlineAt 仍按引擎触发时刻）。 */
export const GAME_WS_ACTION_REQUIRED_DELAY_MS = 2000

/** 阶段推进时，延迟多久推送 `game-stage-changed`（库表仍立即写入）。 */
export const GAME_WS_STAGE_CHANGED_DELAY_MS = 3000
