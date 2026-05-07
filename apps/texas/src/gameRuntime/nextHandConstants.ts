/**
 * 下一手倒计时相关常量（与 `nextHandCountdown`、客户端展示对齐）。
 */

/**
 * 与 `game-end` 后客户端结算展示时长一致：
 * 上一手结束并下发 `game-end` 后，再经过本时长才推送 `next-hand-countdown-started`。
 */
export const NEXT_HAND_COUNTDOWN_PUSH_DELAY_MS = 5000

/**
 * 局间倒计时（相对推送里的 `serverNow`）语义：
 * - `lockAt`：从此刻起不可再退出（锁座），须不晚于 `endsAt`。
 * - `endsAt`：客户端「整段局间倒计时」常见终点；到达后服务端再走发牌/开局链。
 * 二者必须满足 lock 偏移 <= ends 偏移，否则会先分配角色再锁座（见 `nextHandCountdown` 定时器顺序）。
 */
/** 到 `lockAt` 的毫秒偏移（「第几秒开始锁座」） */
export const NEXT_HAND_LOCK_AT_OFFSET_MS = 3000

/** 锁座之后到 `endsAt` 的尾段（毫秒）；整段倒计时时长 = 本值 + `NEXT_HAND_LOCK_AT_OFFSET_MS` */
export const NEXT_HAND_LOCKED_TAIL_BEFORE_ENDS_MS = 2000

/** 到 `endsAt` 的毫秒偏移；与上面两常量保持恒等式，避免改了一处漏改另一处 */
export const NEXT_HAND_ENDS_AT_OFFSET_MS =
  NEXT_HAND_LOCK_AT_OFFSET_MS + NEXT_HAND_LOCKED_TAIL_BEFORE_ENDS_MS

/** 抵达 `endsAt` 后再延迟多久发牌（毫秒） */
export const NEXT_HAND_DEAL_AFTER_END_MS = 2000

/** 发牌之后再延迟多久执行 `controller.start`（毫秒） */
export const NEXT_HAND_START_AFTER_DEAL_MS = 3000
