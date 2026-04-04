/**
 * 下一手倒计时相关常量（与 `nextHandCountdown`、客户端展示对齐）。
 */

/** 上一手结束到推送 `next-hand-countdown-started` 的间隔（毫秒） */
export const NEXT_HAND_COUNTDOWN_PUSH_DELAY_MS = 4000

/** 推送报文里的 `serverNow` 起算，到 `lockAt`（毫秒） */
export const NEXT_HAND_LOCK_AT_OFFSET_MS = 7000

/** 推送报文里的 `serverNow` 起算，到 `endsAt`（毫秒）；客户端整段倒计时终点 */
export const NEXT_HAND_ENDS_AT_OFFSET_MS = 10000

/** 抵达 `endsAt` 后再延迟多久发牌（毫秒） */
export const NEXT_HAND_DEAL_AFTER_END_MS = 2000

/** 发牌之后再延迟多久执行 `controller.start`（毫秒） */
export const NEXT_HAND_START_AFTER_DEAL_MS = 3000
