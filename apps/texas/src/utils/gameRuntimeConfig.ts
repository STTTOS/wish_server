import { logger } from '../logger'
import {
  NEXT_HAND_DEAL_AFTER_END_MS,
  NEXT_HAND_ENDS_AT_OFFSET_MS,
  NEXT_HAND_LOCK_AT_OFFSET_MS,
  NEXT_HAND_START_AFTER_DEAL_MS,
  NEXT_HAND_COUNTDOWN_PUSH_DELAY_MS
} from '../constants/nextHand'
import {
  MIN_THINKING_TIME,
  GAME_WS_STAGE_CHANGED_DELAY_MS,
  INITIAL_CHIPS_MIN_BB_MULTIPLIER,
  GAME_WS_ACTION_REQUIRED_DELAY_MS,
  DEFAULT_INITIAL_CHIPS_MIN_BB_MULTIPLIER
} from '../constants/game'

const MIN_MS = 0
const MAX_MS = 120_000

const MIN_THINKING_SEC = 1
const MAX_THINKING_SEC = 120
const MIN_CHIPS_MULT = 2
const MAX_CHIPS_MULT = 500

/** 首局：进入游戏 UI 过渡后再分配角色（原硬编码 500） */
const DEFAULT_START_GAME_BEFORE_ASSIGN_ROLES_MS = 500

function clampMs(n: number): number {
  return Math.min(MAX_MS, Math.max(MIN_MS, Math.trunc(n)))
}

function clampInt(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.trunc(n)))
}

function isFiniteInt(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n)
}

/** `POST /game/setRuntimeConfig` 可选字段；均为运行时覆盖，单位除注明外为毫秒 */
export type GameRuntimeConfigPatch = {
  /** 思考时间下限（秒），建房校验 */
  minThinkingTime?: unknown
  /** 初始筹码相对大盲的最低倍数 */
  initialChipsMinBigBlindMultiplier?: unknown
  /** 客户端默认展示的初始筹码倍数（须 ≥ 上一项） */
  defaultInitialChipsMinBigBlindMultiplier?: unknown
  /** 行动结束后、`pendingFlowOps` 开始消费前的间隔（下一位 `player-action-required` 等） */
  actionRequiredWsDelayMs?: unknown
  /** `pendingFlowOps` 连续进街间隔；摊牌后 `game-end` 推送前停顿亦用此值（不推迟 `game-stage-changed` 本身） */
  stageChangedWsDelayMs?: unknown
  /** 首局进桌后延迟再分配角色 */
  startGameBeforeAssignRolesDelayMs?: unknown
  /** `game-end` 后延迟再推 `next-hand-countdown-started` */
  nextHandCountdownPushDelayMs?: unknown
  /** 倒计时起点到 `lockAt`（锁座）的偏移 */
  nextHandLockAtOffsetMs?: unknown
  /** 倒计时起点到 `endsAt`（分配角色时刻）的偏移 */
  nextHandEndsAtOffsetMs?: unknown
  /** `endsAt` 之后再延迟多久发牌 */
  nextHandDealAfterEndMs?: unknown
  /** 发牌后再延迟多久 `controller.start` */
  nextHandStartAfterDealMs?: unknown
}

export type GameRuntimeConfigSnapshot = {
  /** 思考时间下限（秒） */
  minThinkingTime: number
  /** 初始筹码相对大盲的最低倍数 */
  initialChipsMinBigBlindMultiplier: number
  /** 默认初始筹码倍数 */
  defaultInitialChipsMinBigBlindMultiplier: number
  /** `pendingFlowOps` 消费前间隔（毫秒） */
  actionRequiredWsDelayMs: number
  /** 连续进街间隔与摊牌后 `game-end` 前停顿（毫秒） */
  stageChangedWsDelayMs: number
  /** 首局进桌后延迟再分配角色（毫秒） */
  startGameBeforeAssignRolesDelayMs: number
  /** `game-end` 后延迟再推局间倒计时（毫秒） */
  nextHandCountdownPushDelayMs: number
  /** 倒计时起点到锁座 `lockAt`（毫秒） */
  nextHandLockAtOffsetMs: number
  /** 倒计时起点到分配角色 `endsAt`（毫秒） */
  nextHandEndsAtOffsetMs: number
  /** `endsAt` 之后再延迟发牌（毫秒） */
  nextHandDealAfterEndMs: number
  /** 发牌后再延迟开局（毫秒） */
  nextHandStartAfterDealMs: number
}

/**
 * 德州运行时可调参数（进程内单例）。新建房间校验、引擎 WS 延迟、局间倒计时等均读此实例。
 */
export class GameRuntimeConfigStore {
  #minThinkingTimeSec = MIN_THINKING_TIME
  #initialChipsMinBigBlindMultiplier = INITIAL_CHIPS_MIN_BB_MULTIPLIER
  #defaultInitialChipsMinBigBlindMultiplier =
    DEFAULT_INITIAL_CHIPS_MIN_BB_MULTIPLIER

  #actionRequiredDelayMs = GAME_WS_ACTION_REQUIRED_DELAY_MS
  #stageChangedDelayMs = GAME_WS_STAGE_CHANGED_DELAY_MS
  #startGameBeforeAssignRolesDelayMs = DEFAULT_START_GAME_BEFORE_ASSIGN_ROLES_MS

  #nextHandCountdownPushDelayMs = NEXT_HAND_COUNTDOWN_PUSH_DELAY_MS
  #nextHandLockAtOffsetMs = NEXT_HAND_LOCK_AT_OFFSET_MS
  #nextHandEndsAtOffsetMs = NEXT_HAND_ENDS_AT_OFFSET_MS
  #nextHandDealAfterEndMs = NEXT_HAND_DEAL_AFTER_END_MS
  #nextHandStartAfterDealMs = NEXT_HAND_START_AFTER_DEAL_MS

  getMinThinkingTime(): number {
    return this.#minThinkingTimeSec
  }

  getInitialChipsMinBigBlindMultiplier(): number {
    return this.#initialChipsMinBigBlindMultiplier
  }

  getDefaultInitialChipsMinBigBlindMultiplier(): number {
    return this.#defaultInitialChipsMinBigBlindMultiplier
  }

  getGameWsActionRequiredDelayMs(): number {
    return this.#actionRequiredDelayMs
  }

  getGameWsStageChangedDelayMs(): number {
    return this.#stageChangedDelayMs
  }

  getStartGameBeforeAssignRolesDelayMs(): number {
    return this.#startGameBeforeAssignRolesDelayMs
  }

  getNextHandCountdownPushDelayMs(): number {
    return this.#nextHandCountdownPushDelayMs
  }

  getNextHandLockAtOffsetMs(): number {
    return this.#nextHandLockAtOffsetMs
  }

  getNextHandEndsAtOffsetMs(): number {
    return this.#nextHandEndsAtOffsetMs
  }

  getNextHandDealAfterEndMs(): number {
    return this.#nextHandDealAfterEndMs
  }

  getNextHandStartAfterDealMs(): number {
    return this.#nextHandStartAfterDealMs
  }

  /** 供 GET /game/config（不含各类内部延时毫秒） */
  getClientRulesSnapshot(): Pick<
    GameRuntimeConfigSnapshot,
    | 'minThinkingTime'
    | 'initialChipsMinBigBlindMultiplier'
    | 'defaultInitialChipsMinBigBlindMultiplier'
  > {
    return {
      minThinkingTime: this.#minThinkingTimeSec,
      initialChipsMinBigBlindMultiplier:
        this.#initialChipsMinBigBlindMultiplier,
      defaultInitialChipsMinBigBlindMultiplier:
        this.#defaultInitialChipsMinBigBlindMultiplier
    }
  }

  getFullSnapshot(): GameRuntimeConfigSnapshot {
    return {
      ...this.getClientRulesSnapshot(),
      actionRequiredWsDelayMs: this.#actionRequiredDelayMs,
      stageChangedWsDelayMs: this.#stageChangedDelayMs,
      startGameBeforeAssignRolesDelayMs:
        this.#startGameBeforeAssignRolesDelayMs,
      nextHandCountdownPushDelayMs: this.#nextHandCountdownPushDelayMs,
      nextHandLockAtOffsetMs: this.#nextHandLockAtOffsetMs,
      nextHandEndsAtOffsetMs: this.#nextHandEndsAtOffsetMs,
      nextHandDealAfterEndMs: this.#nextHandDealAfterEndMs,
      nextHandStartAfterDealMs: this.#nextHandStartAfterDealMs
    }
  }

  /**
   * 运行时调参。已排队的 setTimeout 仍按调度时的数值执行；新开局/新倒计时用新值。
   */
  applyPatch(
    input: GameRuntimeConfigPatch
  ):
    | { ok: true; data: GameRuntimeConfigSnapshot }
    | { ok: false; message: string } {
    const touched = Object.keys(input).filter(
      (k) => input[k as keyof GameRuntimeConfigPatch] !== undefined
    )
    if (touched.length === 0) {
      return { ok: false, message: '请至少传入一个字段' }
    }

    let nextMinThinking = this.#minThinkingTimeSec
    let nextInitialMult = this.#initialChipsMinBigBlindMultiplier
    let nextDefaultMult = this.#defaultInitialChipsMinBigBlindMultiplier
    let nextActionReq = this.#actionRequiredDelayMs
    let nextStageCh = this.#stageChangedDelayMs
    let nextStartAssign = this.#startGameBeforeAssignRolesDelayMs
    let nextPushDelay = this.#nextHandCountdownPushDelayMs
    let nextLockOff = this.#nextHandLockAtOffsetMs
    let nextEndsOff = this.#nextHandEndsAtOffsetMs
    let nextDealAfter = this.#nextHandDealAfterEndMs
    let nextStartAfter = this.#nextHandStartAfterDealMs

    if (input.minThinkingTime !== undefined) {
      if (!isFiniteInt(input.minThinkingTime)) {
        return { ok: false, message: 'minThinkingTime 须为有限数字' }
      }
      nextMinThinking = clampInt(
        input.minThinkingTime,
        MIN_THINKING_SEC,
        MAX_THINKING_SEC
      )
    }

    if (input.initialChipsMinBigBlindMultiplier !== undefined) {
      if (!isFiniteInt(input.initialChipsMinBigBlindMultiplier)) {
        return {
          ok: false,
          message: 'initialChipsMinBigBlindMultiplier 须为有限数字'
        }
      }
      nextInitialMult = clampInt(
        input.initialChipsMinBigBlindMultiplier,
        MIN_CHIPS_MULT,
        MAX_CHIPS_MULT
      )
    }

    if (input.defaultInitialChipsMinBigBlindMultiplier !== undefined) {
      if (!isFiniteInt(input.defaultInitialChipsMinBigBlindMultiplier)) {
        return {
          ok: false,
          message: 'defaultInitialChipsMinBigBlindMultiplier 须为有限数字'
        }
      }
      nextDefaultMult = clampInt(
        input.defaultInitialChipsMinBigBlindMultiplier,
        MIN_CHIPS_MULT,
        MAX_CHIPS_MULT
      )
    }

    if (nextDefaultMult < nextInitialMult) {
      return {
        ok: false,
        message:
          'defaultInitialChipsMinBigBlindMultiplier 不可小于 initialChipsMinBigBlindMultiplier'
      }
    }

    const applyMs = (
      raw: unknown,
      field: string
    ): { ok: true; v: number } | { ok: false; message: string } => {
      if (!isFiniteInt(raw)) {
        return { ok: false, message: `${field} 须为有限数字` }
      }
      return { ok: true, v: clampMs(raw) }
    }

    if (input.actionRequiredWsDelayMs !== undefined) {
      const r = applyMs(
        input.actionRequiredWsDelayMs,
        'actionRequiredWsDelayMs'
      )
      if (!r.ok) return r
      nextActionReq = r.v
    }
    if (input.stageChangedWsDelayMs !== undefined) {
      const r = applyMs(input.stageChangedWsDelayMs, 'stageChangedWsDelayMs')
      if (!r.ok) return r
      nextStageCh = r.v
    }
    if (input.startGameBeforeAssignRolesDelayMs !== undefined) {
      const r = applyMs(
        input.startGameBeforeAssignRolesDelayMs,
        'startGameBeforeAssignRolesDelayMs'
      )
      if (!r.ok) return r
      nextStartAssign = r.v
    }
    if (input.nextHandCountdownPushDelayMs !== undefined) {
      const r = applyMs(
        input.nextHandCountdownPushDelayMs,
        'nextHandCountdownPushDelayMs'
      )
      if (!r.ok) return r
      nextPushDelay = r.v
    }
    if (input.nextHandLockAtOffsetMs !== undefined) {
      const r = applyMs(input.nextHandLockAtOffsetMs, 'nextHandLockAtOffsetMs')
      if (!r.ok) return r
      nextLockOff = r.v
    }
    if (input.nextHandEndsAtOffsetMs !== undefined) {
      const r = applyMs(input.nextHandEndsAtOffsetMs, 'nextHandEndsAtOffsetMs')
      if (!r.ok) return r
      nextEndsOff = r.v
    }
    if (input.nextHandDealAfterEndMs !== undefined) {
      const r = applyMs(input.nextHandDealAfterEndMs, 'nextHandDealAfterEndMs')
      if (!r.ok) return r
      nextDealAfter = r.v
    }
    if (input.nextHandStartAfterDealMs !== undefined) {
      const r = applyMs(
        input.nextHandStartAfterDealMs,
        'nextHandStartAfterDealMs'
      )
      if (!r.ok) return r
      nextStartAfter = r.v
    }

    this.#minThinkingTimeSec = nextMinThinking
    this.#initialChipsMinBigBlindMultiplier = nextInitialMult
    this.#defaultInitialChipsMinBigBlindMultiplier = nextDefaultMult
    this.#actionRequiredDelayMs = nextActionReq
    this.#stageChangedDelayMs = nextStageCh
    this.#startGameBeforeAssignRolesDelayMs = nextStartAssign
    this.#nextHandCountdownPushDelayMs = nextPushDelay
    this.#nextHandLockAtOffsetMs = nextLockOff
    this.#nextHandEndsAtOffsetMs = nextEndsOff
    this.#nextHandDealAfterEndMs = nextDealAfter
    this.#nextHandStartAfterDealMs = nextStartAfter

    const data = this.getFullSnapshot()
    logger.info(`[gameRuntimeConfig] updated ${JSON.stringify(data)}`)
    return { ok: true, data }
  }
}

/** 全应用共用的运行时配置单例 */
export const gameRuntimeConfig = new GameRuntimeConfigStore()
