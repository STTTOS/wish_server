import { logger } from '../logger'
import prisma, { room as roomModel } from '../models'
import { WAITING_ROOM_EMPTY_CLEANUP_DELAY_MS } from '../constants/ws'
import { gameRuntimeRegistry } from '../router/game/services/runtimeRegistry'
import {
  cancelNextHandCountdown,
  unregisterNextHandHooks
} from '../gameRuntime/nextHandCountdown'

type RoomCleanupManagerDeps = {
  getWaitingRoomSocketCount: (roomId: string) => number
  /**
   * waiting-room 全离线软删房间成功后调用：须向 `/room-list` 推送
   * `{ type: 'room-list-room-deleted', data: { roomId } }`，与 HTTP 退出最后一人一致。
   */
  onWaitingRoomDeleted: (roomId: number) => void
  /** 测试可缩短；默认 {@link WAITING_ROOM_EMPTY_CLEANUP_DELAY_MS} */
  waitingRoomEmptyCleanupDelayMs?: number
}

/**
 * 统一处理 waiting-room 与 game-room 的离线清理策略。
 */
export class RoomCleanupManager {
  #scheduledWaitingRoomCleanupTimers = new Map<
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
   */
  scheduleTryCleanupWaitingRoomIfAllOffline(roomId: string) {
    if (this.deps.getWaitingRoomSocketCount(roomId) > 0) {
      this.cancelScheduledWaitingRoomCleanup(roomId)
      return
    }
    this.cancelScheduledWaitingRoomCleanup(roomId)
    const delayMs = this.#waitingRoomEmptyCleanupDelayMs()
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

  /**
   * game-room 全离线时，清理倒计时/运行时并按需联动 waiting-room 清理。
   */
  async tryCleanupRoomIfAllOffline(roomId: string) {
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

    if (players.length === 0) {
      safeClearCountdown()
      gameRuntimeRegistry.destroyRuntime(roomId)
      await this.#resetRoomGameStatusToWaiting(roomIdNumber)
      this.scheduleTryCleanupWaitingRoomIfAllOffline(roomId)
      return
    }

    const allOffline = gameRuntimeRegistry.areAllTrackedPlayersOffline(roomId)
    if (!allOffline) return

    safeClearCountdown()
    gameRuntimeRegistry.destroyRuntime(roomId)
    logger.info(`[room-cleanup] all offline, removed room ${roomId}`)
    await this.#resetRoomGameStatusToWaiting(roomIdNumber)
    this.scheduleTryCleanupWaitingRoomIfAllOffline(roomId)
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
