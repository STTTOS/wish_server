import { logger } from '../logger'
import prisma, { room as roomModel } from '../models'
import { gameRuntimeRegistry } from '../router/game/services/runtimeRegistry'
import {
  cancelNextHandCountdown,
  unregisterNextHandHooks
} from '../gameRuntime/nextHandCountdown'
import {
  WAITING_ROOM_EMPTY_CLEANUP_DELAY_MS,
  GAME_ROOM_ALL_OFFLINE_TEARDOWN_DELAY_MS
} from '../constants/ws'

type RoomCleanupManagerDeps = {
  getWaitingRoomSocketCount: (roomId: string) => number
  getGameRoomSocketCount: (roomId: string) => number
  /**
   * waiting-room 全离线软删房间成功后调用：须向 `/room-list` 推送
   * `{ type: 'room-list-room-deleted', data: { roomId } }`，与 HTTP 退出最后一人一致。
   */
  onWaitingRoomDeleted: (roomId: number) => void
  /** 测试可缩短；默认 {@link WAITING_ROOM_EMPTY_CLEANUP_DELAY_MS} */
  waitingRoomEmptyCleanupDelayMs?: number
  /** 测试可缩短；默认 {@link GAME_ROOM_ALL_OFFLINE_TEARDOWN_DELAY_MS} */
  gameRoomAllOfflineTeardownDelayMs?: number
}

/**
 * 统一处理 waiting-room 与 game-room 的离线清理策略。
 */
export class RoomCleanupManager {
  #scheduledWaitingRoomCleanupTimers = new Map<
    string,
    ReturnType<typeof setTimeout>
  >()
  #scheduledGameRoomCleanupTimers = new Map<
    string,
    ReturnType<typeof setTimeout>
  >()

  constructor(private readonly deps: RoomCleanupManagerDeps) {}

  #waitingRoomEmptyCleanupDelayMs(): number {
    return (
      this.deps.waitingRoomEmptyCleanupDelayMs ??
      WAITING_ROOM_EMPTY_CLEANUP_DELAY_MS
    )
  }

  #gameRoomAllOfflineTeardownDelayMs(): number {
    return (
      this.deps.gameRoomAllOfflineTeardownDelayMs ??
      GAME_ROOM_ALL_OFFLINE_TEARDOWN_DELAY_MS
    )
  }

  /**
   * 取消已排队的 game-room 全员离线清理（重连时调用）。
   */
  cancelScheduledGameRoomCleanup(roomId: string) {
    const timer = this.#scheduledGameRoomCleanupTimers.get(roomId)
    if (timer == null) return
    clearTimeout(timer)
    this.#scheduledGameRoomCleanupTimers.delete(roomId)
  }

  /**
   * /game 当前无连接时，延迟 {@link GAME_ROOM_ALL_OFFLINE_TEARDOWN_DELAY_MS} 后 purge 对局并拆 runtime。
   * 仍有人连 /game 时不排队；重连时须 {@link cancelScheduledGameRoomCleanup}。
   */
  scheduleTryCleanupGameRoomIfAllOffline(roomId: string) {
    if (this.deps.getGameRoomSocketCount(roomId) > 0) {
      this.cancelScheduledGameRoomCleanup(roomId)
      return
    }
    this.cancelScheduledGameRoomCleanup(roomId)
    const delayMs = this.#gameRoomAllOfflineTeardownDelayMs()
    const timer = setTimeout(() => {
      this.#scheduledGameRoomCleanupTimers.delete(roomId)
      void this.tryCleanupRoomIfAllOffline(roomId)
    }, delayMs)
    this.#scheduledGameRoomCleanupTimers.set(roomId, timer)
    logger.info(
      `[game-room-cleanup] scheduled runtime teardown roomId=${roomId} in ${delayMs}ms (no /game sockets)`
    )
  }

  /**
   * 取消已排队的 waiting-room 全员离线软删（重连 / 仍有人在线时调用）。
   */
  cancelScheduledWaitingRoomCleanup(roomId: string) {
    const timer = this.#scheduledWaitingRoomCleanupTimers.get(roomId)
    if (timer == null) return
    clearTimeout(timer)
    this.#scheduledWaitingRoomCleanupTimers.delete(roomId)
  }

  /**
   * waiting-room 当前无连接时，延迟尝试软删（避免切后台断线立刻清房）。
   * @param delayMs 默认 {@link WAITING_ROOM_EMPTY_CLEANUP_DELAY_MS}；对局拆桌后联动可用 {@link GAME_ROOM_ALL_OFFLINE_TEARDOWN_DELAY_MS}。
   */
  scheduleTryCleanupWaitingRoomIfAllOffline(
    roomId: string,
    options?: { delayMs?: number }
  ) {
    if (this.deps.getWaitingRoomSocketCount(roomId) > 0) {
      this.cancelScheduledWaitingRoomCleanup(roomId)
      return
    }
    this.cancelScheduledWaitingRoomCleanup(roomId)
    const delayMs = options?.delayMs ?? this.#waitingRoomEmptyCleanupDelayMs()
    const timer = setTimeout(() => {
      this.#scheduledWaitingRoomCleanupTimers.delete(roomId)
      void this.tryCleanupWaitingRoomIfAllOffline(roomId)
    }, delayMs)
    this.#scheduledWaitingRoomCleanupTimers.set(roomId, timer)
    logger.info(
      `[waiting-room-cleanup] scheduled soft-delete check roomId=${roomId} in ${delayMs}ms`
    )
  }

  /**
   * waiting-room 全离线时，按状态规则尝试软删房间。
   */
  async tryCleanupWaitingRoomIfAllOffline(roomId: string) {
    logger.info(
      `[room-cleanup] tryCleanupWaitingRoomIfAllOffline, roomId=${roomId}`,
      'socket count',
      this.deps.getWaitingRoomSocketCount(roomId)
    )
    const roomIdNumber = Number(roomId)
    if (!roomIdNumber) return
    if (this.deps.getWaitingRoomSocketCount(roomId) > 0) return
    const info = await roomModel.findUnique({
      where: { id: roomIdNumber },
      select: { deletedAt: true, gameStatus: true }
    })
    if (!info || info.deletedAt) return
    if (info.gameStatus !== 'waiting') return
    if (gameRuntimeRegistry.hasTexas(roomId)) return
    try {
      await prisma.$transaction(async (tx) => {
        await tx.room.update({
          where: { id: roomIdNumber },
          data: { deletedAt: new Date(), activeOwnerId: null, activeCode: null }
        })
        await tx.roomMember.deleteMany({ where: { roomId: roomIdNumber } })
      })
      logger.info(
        `[waiting-room-cleanup] all offline, soft-deleted room ${roomIdNumber}`
      )
      this.deps.onWaitingRoomDeleted(roomIdNumber)
    } catch (e) {
      logger.error('[waiting-room-cleanup] failed', e)
    }
  }

  #shouldTeardownGameRuntime(roomId: string, playerCount: number): boolean {
    if (playerCount === 0) return true
    return this.deps.getGameRoomSocketCount(roomId) === 0
  }

  /**
   * /game 全离线且倒计时到期：purge 对局、拆 runtime，并尽量软删房间。
   */
  async tryCleanupRoomIfAllOffline(roomId: string) {
    if (this.deps.getGameRoomSocketCount(roomId) > 0) return

    const texas = gameRuntimeRegistry.getTexas(roomId)
    if (!texas) return

    const players = texas.room.getAllPlayers()
    const roomIdNumber = Number(roomId)
    const safeClearCountdown = () => {
      if (!roomIdNumber) return
      try {
        cancelNextHandCountdown(roomIdNumber)
        unregisterNextHandHooks(roomIdNumber)
      } catch {
        // ignore
      }
    }

    if (!this.#shouldTeardownGameRuntime(roomId, players.length)) return

    if (roomIdNumber) {
      const { abandonInProgressMatchOnTeardown } = await import(
        '../router/game/services/abandonInProgressMatch'
      )
      await abandonInProgressMatchOnTeardown(roomIdNumber, roomId)
    }

    safeClearCountdown()
    gameRuntimeRegistry.destroyRuntime(roomId)
    logger.info(`[room-cleanup] teardown runtime room ${roomId}`)
    await this.#resetRoomGameStatusToWaiting(roomIdNumber)
    await this.#finalizeRoomAfterGameTeardown(roomId)
  }

  /**
   * 对局已 purge + runtime 已销毁：waiting-room 无人则立即软删；否则短延迟再试。
   */
  async #finalizeRoomAfterGameTeardown(roomId: string) {
    if (this.deps.getWaitingRoomSocketCount(roomId) === 0) {
      await this.tryCleanupWaitingRoomIfAllOffline(roomId)
      return
    }
    this.scheduleTryCleanupWaitingRoomIfAllOffline(roomId, {
      delayMs: this.#gameRoomAllOfflineTeardownDelayMs()
    })
  }

  /**
   * 运行时已销毁后把 DB 拉回 waiting，与 join/quit 等路由约定一致。
   * 不走 transitionRoomGameStatus：清理路径允许从 in_hand / starting_hand / between_hands / entering 等直接落回 waiting。
   */
  async #resetRoomGameStatusToWaiting(roomIdNumber: number) {
    if (!roomIdNumber) return
    try {
      await roomModel.update({
        where: { id: roomIdNumber },
        data: { gameStatus: 'waiting' }
      })
      logger.info(
        `[room-cleanup] room ${roomIdNumber} gameStatus -> waiting after runtime destroyed`
      )
    } catch (e) {
      logger.error('[room-cleanup] reset gameStatus to waiting failed', e)
    }
  }
}
