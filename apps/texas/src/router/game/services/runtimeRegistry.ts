import type { Texas } from 'texas-poker-core'
import type { StartRoomInfo, MatchRollbackManager } from './types'

import { logger } from '../../../logger'
import { clearGameRoomWsReplay } from '../../../SockeServer/gameRoomWsReplayBuffer'

export type GameRuntime = {
  roomKey: string
  roomId: number
  /** 供领域事件解释器（WS 倒计时、思考时间等） */
  roomInfo: StartRoomInfo
  texas: Texas
  /** 当前手 match；作废回滚后置为 null，直至下一手 onLock 再写入新 id */
  currentMatchId: number | null
  /** 当前手从「角色分配完成」起的 unix ms，在 RolesAssigned 解释时更新 */
  matchStartedAt: number
  rollbackManager: MatchRollbackManager
  /**
   * 本手中途离场的聚合状态：
   * - `autoFoldOnTurn`: 轮到该玩家时由业务层自动下发 `FoldDueToLeave`
   * - `removeAfterHandEnd`: 本手结束后 `Texas.reset()` 解锁座再 `room.removeById`
   */
  pendingLeaveByUserId: Map<
    number,
    { autoFoldOnTurn: boolean; removeAfterHandEnd: boolean }
  >
  /**
   * `onLock`（或首局分配角色前）至本手领域事件 `BlindsPosted` 处理完成前，禁止局内退出。
   */
  quitBlockedUntilBlindsPosted: boolean
  /** 下手开局后需尝试 `PostBigBlind` 的新入座玩家。 */
  pendingPostBigBlindUserIds: Set<number>
}

/**
 * 最小版运行时注册中心：统一维护房间维度的对局运行时上下文。
 */
export class GameRuntimeRegistry {
  #runtimes = new Map<string, GameRuntime>()

  /** 注册或覆盖某个房间的运行时上下文。 */
  register(runtime: GameRuntime) {
    this.#runtimes.set(runtime.roomKey, runtime)
  }

  /** 强制获取运行时，不存在则抛错。 */
  getOrThrow(roomKey: string) {
    const runtime = this.#runtimes.get(roomKey)
    if (!runtime) throw new Error(`game runtime not found: roomKey=${roomKey}`)
    return runtime
  }

  /** 读取房间 Texas 实例（可空）。 */
  getTexas(roomKey: string) {
    return this.#runtimes.get(roomKey)?.texas
  }

  /** 强制读取房间 Texas 实例，不存在则抛错。 */
  getTexasOrThrow(roomKey: string) {
    return this.getOrThrow(roomKey).texas
  }

  /** 判断房间是否存在可用 Texas 实例。 */
  hasTexas(roomKey: string) {
    return Boolean(this.#runtimes.get(roomKey)?.texas)
  }

  /** 读取当前手 matchId（可空）。 */
  getCurrentMatchId(roomKey: string) {
    return this.#runtimes.get(roomKey)?.currentMatchId
  }

  /** 更新当前手 matchId。 */
  setCurrentMatchId(roomKey: string, matchId: number) {
    const runtime = this.getOrThrow(roomKey)
    runtime.currentMatchId = matchId
  }

  /** 本手 `reset` 解锁座后，摘掉已离房但仍留在环上的玩家（见 `pendingLeaveByUserId`）。 */
  flushDeferredTexasSeatRemovals(roomKey: string): number[] {
    const runtime = this.#runtimes.get(roomKey)
    if (!runtime?.texas) return []
    const removedUserIds: number[] = []
    for (const [userId, state] of [...runtime.pendingLeaveByUserId.entries()]) {
      if (!state.removeAfterHandEnd) continue
      try {
        if (runtime.texas.room.has(userId)) {
          runtime.texas.room.removeById(userId)
        }
        removedUserIds.push(userId)
      } catch (e) {
        logger.error(
          `[runtime] deferred removeById failed roomKey=${roomKey} userId=${userId}`,
          e
        )
      }
      runtime.pendingLeaveByUserId.delete(userId)
    }
    return removedUserIds
  }

  queueLeaveDuringHand(roomKey: string, userId: number): void {
    const runtime = this.#runtimes.get(roomKey)
    if (!runtime) return
    const current = runtime.pendingLeaveByUserId.get(userId)
    runtime.pendingLeaveByUserId.set(userId, {
      autoFoldOnTurn: true,
      removeAfterHandEnd: true,
      ...(current ?? {})
    })
  }

  cancelQueuedLeave(roomKey: string, userId: number): void {
    const runtime = this.#runtimes.get(roomKey)
    if (!runtime) return
    runtime.pendingLeaveByUserId.delete(userId)
  }

  consumeQueuedLeaveAutoFold(roomKey: string, userId: number): boolean {
    const runtime = this.#runtimes.get(roomKey)
    if (!runtime) return false
    const current = runtime.pendingLeaveByUserId.get(userId)
    if (!current?.autoFoldOnTurn) return false
    if (current.removeAfterHandEnd) {
      runtime.pendingLeaveByUserId.set(userId, {
        autoFoldOnTurn: false,
        removeAfterHandEnd: true
      })
    } else {
      runtime.pendingLeaveByUserId.delete(userId)
    }
    return true
  }

  restoreQueuedLeaveAutoFold(roomKey: string, userId: number): void {
    const runtime = this.#runtimes.get(roomKey)
    if (!runtime) return
    const current = runtime.pendingLeaveByUserId.get(userId)
    runtime.pendingLeaveByUserId.set(userId, {
      autoFoldOnTurn: true,
      removeAfterHandEnd: current?.removeAfterHandEnd ?? true
    })
  }

  setQuitBlockedUntilBlindsPosted(roomKey: string, blocked: boolean): void {
    const runtime = this.#runtimes.get(roomKey)
    if (!runtime) return
    runtime.quitBlockedUntilBlindsPosted = blocked
  }

  isQuitBlockedUntilBlindsPosted(roomKey: string): boolean {
    return Boolean(this.#runtimes.get(roomKey)?.quitBlockedUntilBlindsPosted)
  }

  enqueuePendingPostBigBlind(roomKey: string, userId: number): void {
    const runtime = this.#runtimes.get(roomKey)
    if (!runtime) return
    runtime.pendingPostBigBlindUserIds.add(userId)
  }

  removePendingPostBigBlind(roomKey: string, userId: number): void {
    const runtime = this.#runtimes.get(roomKey)
    if (!runtime) return
    runtime.pendingPostBigBlindUserIds.delete(userId)
  }

  consumePendingPostBigBlind(roomKey: string): number[] {
    const runtime = this.#runtimes.get(roomKey)
    if (!runtime || runtime.pendingPostBigBlindUserIds.size === 0) return []
    const out = [...runtime.pendingPostBigBlindUserIds]
    runtime.pendingPostBigBlindUserIds.clear()
    return out
  }

  /** 销毁运行时：reset Texas 后移除上下文。 */
  destroyRuntime(roomKey: string) {
    const runtime = this.#runtimes.get(roomKey)
    if (runtime?.texas) {
      runtime.texas.reset()
      this.flushDeferredTexasSeatRemovals(roomKey)
    }
    this.#runtimes.delete(roomKey)
    clearGameRoomWsReplay(roomKey)
    void import('./texasDomain/playerTurnTimeoutScheduler').then((m) =>
      m.clearPlayerTurnTimeout(roomKey)
    )
  }
}

export const gameRuntimeRegistry = new GameRuntimeRegistry()
