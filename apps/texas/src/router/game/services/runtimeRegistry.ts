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
   * - 集合内 userId 会在本手结束后 `Texas.reset()` 解锁座再 `room.removeById`
   */
  pendingLeaveByUserId: Set<number>
  /**
   * `onLock`（或首局分配角色前）至本手领域事件 `BlindsPosted` 处理完成前，禁止局内退出。
   */
  quitBlockedUntilBlindsPosted: boolean
  /** 下手开局后需尝试 `PostBigBlind` 的新入座玩家。 */
  pendingPostBigBlindUserIds: Set<number>
  /** 对局内连接状态（业务层权威，避免耦合 Core Player）。 */
  offlineUserIds: Set<number>
  /** 离线连续手数（仅统计在座玩家），用于 2 手宽限后移出。 */
  offlineHandCountByUserId: Map<number, number>
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
    for (const userId of [...runtime.pendingLeaveByUserId]) {
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
    runtime.pendingLeaveByUserId.add(userId)
  }

  cancelQueuedLeave(roomKey: string, userId: number): void {
    const runtime = this.#runtimes.get(roomKey)
    if (!runtime) return
    runtime.pendingLeaveByUserId.delete(userId)
  }

  hasQueuedLeave(roomKey: string, userId: number): boolean {
    const runtime = this.#runtimes.get(roomKey)
    if (!runtime) return false
    return runtime.pendingLeaveByUserId.has(userId)
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

  markUserOffline(roomKey: string, userId: number): void {
    const runtime = this.#runtimes.get(roomKey)
    if (!runtime) return
    runtime.offlineUserIds.add(userId)
  }

  markUserOnline(roomKey: string, userId: number): void {
    const runtime = this.#runtimes.get(roomKey)
    if (!runtime) return
    runtime.offlineUserIds.delete(userId)
    runtime.offlineHandCountByUserId.delete(userId)
  }

  clearConnectionTracking(roomKey: string, userId: number): void {
    const runtime = this.#runtimes.get(roomKey)
    if (!runtime) return
    runtime.offlineUserIds.delete(userId)
    runtime.offlineHandCountByUserId.delete(userId)
  }

  isUserOffline(roomKey: string, userId: number): boolean {
    const runtime = this.#runtimes.get(roomKey)
    if (!runtime) return false
    return runtime.offlineUserIds.has(userId)
  }

  getUserConnectionStatus(
    roomKey: string,
    userId: number
  ): 'online' | 'offline' {
    return this.isUserOffline(roomKey, userId) ? 'offline' : 'online'
  }

  bumpOfflineHandCount(roomKey: string, userId: number): number {
    const runtime = this.#runtimes.get(roomKey)
    if (!runtime) return 0
    const next = (runtime.offlineHandCountByUserId.get(userId) ?? 0) + 1
    runtime.offlineHandCountByUserId.set(userId, next)
    return next
  }

  resetOfflineHandCount(roomKey: string, userId: number): void {
    const runtime = this.#runtimes.get(roomKey)
    if (!runtime) return
    runtime.offlineHandCountByUserId.delete(userId)
  }

  areAllTrackedPlayersOffline(roomKey: string): boolean {
    const runtime = this.#runtimes.get(roomKey)
    if (!runtime?.texas) return false
    const players = runtime.texas.room.getAllPlayers()
    if (players.length === 0) return true
    return players.every((p) => runtime.offlineUserIds.has(p.getUserInfo().id))
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
