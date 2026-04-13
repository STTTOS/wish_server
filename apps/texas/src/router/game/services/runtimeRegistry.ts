import type { Texas } from 'texas-poker-core'
import type { StartRoomInfo, MatchRollbackManager } from './types'

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

  /** 销毁运行时：reset Texas 后移除上下文。 */
  destroyRuntime(roomKey: string) {
    const runtime = this.#runtimes.get(roomKey)
    if (runtime?.texas) runtime.texas.reset()
    this.#runtimes.delete(roomKey)
    void import('./texasDomain/playerTurnTimeoutScheduler').then((m) =>
      m.clearPlayerTurnTimeout(roomKey)
    )
  }
}

export const gameRuntimeRegistry = new GameRuntimeRegistry()
