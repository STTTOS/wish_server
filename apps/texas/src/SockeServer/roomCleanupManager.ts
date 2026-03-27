import { logger } from '../logger'
import prisma, { room as roomModel } from '../models'
import { gameRuntimeRegistry } from '../router/game/services/runtimeRegistry'
import {
  cancelNextHandCountdown,
  unregisterNextHandHooks
} from '../gameRuntime/nextHandCountdown'

type RoomCleanupManagerDeps = {
  getWaitingRoomSocketCount: (roomId: string) => number
  onWaitingRoomDeleted?: (roomId: number) => void
}

/**
 * 统一处理 waiting-room 与 game-room 的离线清理策略。
 */
export class RoomCleanupManager {
  constructor(private readonly deps: RoomCleanupManagerDeps) {}

  /**
   * waiting-room 全离线时，按状态规则尝试软删房间。
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
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
          data: { deletedAt: new Date() }
        })
        await tx.roomMember.deleteMany({ where: { roomId: roomIdNumber } })
      })
      logger.info(
        `[waiting-room-cleanup] all offline, soft-deleted room ${roomIdNumber}`
      )
      this.deps.onWaitingRoomDeleted?.(roomIdNumber)
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
      await this.tryCleanupWaitingRoomIfAllOffline(roomId)
      return
    }

    const allOffline = players.every((p) => p.onlineStatus === 'offline')
    if (!allOffline) return

    safeClearCountdown()
    gameRuntimeRegistry.destroyRuntime(roomId)
    logger.info(`[room-cleanup] all offline, removed room ${roomId}`)
    await this.tryCleanupWaitingRoomIfAllOffline(roomId)
  }
}
