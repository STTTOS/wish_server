import { logger } from '../logger'
import {
  GAME_WS_STAGE_CHANGED_DELAY_MS,
  GAME_WS_ACTION_REQUIRED_DELAY_MS
} from '../constants/game'
import {
  NEXT_HAND_DEAL_AFTER_END_MS,
  NEXT_HAND_LOCK_AT_OFFSET_MS,
  NEXT_HAND_START_AFTER_DEAL_MS,
  NEXT_HAND_COUNTDOWN_PUSH_DELAY_MS,
  NEXT_HAND_LOCKED_TAIL_BEFORE_ENDS_MS
} from '../gameRuntime/nextHandConstants'

const MIN_MS = 0
const MAX_MS = 120_000

/** 首局：进入游戏 UI 过渡后再分配角色（原硬编码 500） */
const DEFAULT_START_GAME_BEFORE_ASSIGN_ROLES_MS = 500

function clampMs(n: number): number {
  return Math.min(MAX_MS, Math.max(MIN_MS, Math.trunc(n)))
}

function isFiniteInt(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n)
}

/** `POST /game/setRuntimeConfig` 可选字段；均为运行时覆盖，单位除注明外为毫秒 */
export type GameRuntimeConfigPatch = {
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
  /** 锁座后到 `endsAt`（分配角色）的尾段；与 lock 相加为 ends 偏移。勿再传 `nextHandEndsAtOffsetMs` */
  nextHandLockedTailBeforeEndsMs?: unknown
  /** `endsAt` 之后再延迟多久发牌 */
  nextHandDealAfterEndMs?: unknown
  /** 发牌后再延迟多久 `controller.start` */
  nextHandStartAfterDealMs?: unknown
}

export type GameRuntimeConfigSnapshot = {
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
  /** 锁座后到分配角色 `endsAt`（毫秒） */
  nextHandLockedTailBeforeEndsMs: number
  /** 派生：`lock + tail`，与 WS `endsAt` 一致 */
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
  #actionRequiredDelayMs = GAME_WS_ACTION_REQUIRED_DELAY_MS
  #stageChangedDelayMs = GAME_WS_STAGE_CHANGED_DELAY_MS
  #startGameBeforeAssignRolesDelayMs = DEFAULT_START_GAME_BEFORE_ASSIGN_ROLES_MS

  #nextHandCountdownPushDelayMs = NEXT_HAND_COUNTDOWN_PUSH_DELAY_MS
  #nextHandLockAtOffsetMs = NEXT_HAND_LOCK_AT_OFFSET_MS
  #nextHandLockedTailBeforeEndsMs = NEXT_HAND_LOCKED_TAIL_BEFORE_ENDS_MS
  #nextHandDealAfterEndMs = NEXT_HAND_DEAL_AFTER_END_MS
  #nextHandStartAfterDealMs = NEXT_HAND_START_AFTER_DEAL_MS

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

  getNextHandLockedTailBeforeEndsMs(): number {
    return this.#nextHandLockedTailBeforeEndsMs
  }

  getNextHandEndsAtOffsetMs(): number {
    return this.#nextHandLockAtOffsetMs + this.#nextHandLockedTailBeforeEndsMs
  }

  getNextHandDealAfterEndMs(): number {
    return this.#nextHandDealAfterEndMs
  }

  getNextHandStartAfterDealMs(): number {
    return this.#nextHandStartAfterDealMs
  }

  getFullSnapshot(): GameRuntimeConfigSnapshot {
    return {
      actionRequiredWsDelayMs: this.#actionRequiredDelayMs,
      stageChangedWsDelayMs: this.#stageChangedDelayMs,
      startGameBeforeAssignRolesDelayMs:
        this.#startGameBeforeAssignRolesDelayMs,
      nextHandCountdownPushDelayMs: this.#nextHandCountdownPushDelayMs,
      nextHandLockAtOffsetMs: this.#nextHandLockAtOffsetMs,
      nextHandLockedTailBeforeEndsMs: this.#nextHandLockedTailBeforeEndsMs,
      nextHandEndsAtOffsetMs: this.getNextHandEndsAtOffsetMs(),
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

    let nextActionReq = this.#actionRequiredDelayMs
    let nextStageCh = this.#stageChangedDelayMs
    let nextStartAssign = this.#startGameBeforeAssignRolesDelayMs
    let nextPushDelay = this.#nextHandCountdownPushDelayMs
    let nextLockOff = this.#nextHandLockAtOffsetMs
    let nextTail = this.#nextHandLockedTailBeforeEndsMs
    let nextDealAfter = this.#nextHandDealAfterEndMs
    let nextStartAfter = this.#nextHandStartAfterDealMs

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
    const rawBody = input as Record<string, unknown>
    if (rawBody.nextHandEndsAtOffsetMs !== undefined) {
      return {
        ok: false,
        message:
          '已移除 nextHandEndsAtOffsetMs，请分别配置 nextHandLockAtOffsetMs 与 nextHandLockedTailBeforeEndsMs（ends = lock + tail）'
      }
    }

    if (input.nextHandLockAtOffsetMs !== undefined) {
      const r = applyMs(input.nextHandLockAtOffsetMs, 'nextHandLockAtOffsetMs')
      if (!r.ok) return r
      nextLockOff = r.v
    }
    if (input.nextHandLockedTailBeforeEndsMs !== undefined) {
      const r = applyMs(
        input.nextHandLockedTailBeforeEndsMs,
        'nextHandLockedTailBeforeEndsMs'
      )
      if (!r.ok) return r
      nextTail = r.v
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

    this.#actionRequiredDelayMs = nextActionReq
    this.#stageChangedDelayMs = nextStageCh
    this.#startGameBeforeAssignRolesDelayMs = nextStartAssign
    this.#nextHandCountdownPushDelayMs = nextPushDelay
    this.#nextHandLockAtOffsetMs = nextLockOff
    this.#nextHandLockedTailBeforeEndsMs = nextTail
    this.#nextHandDealAfterEndMs = nextDealAfter
    this.#nextHandStartAfterDealMs = nextStartAfter

    const data = this.getFullSnapshot()
    logger.info(`[gameRuntimeConfig] updated ${JSON.stringify(data)}`)
    return { ok: true, data }
  }
}

/** 全应用共用的运行时配置单例 */
export const gameRuntimeConfig = new GameRuntimeConfigStore()
