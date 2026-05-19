import { logger } from '../../../logger'
import { match as matchModel } from '../../../models'
import { gameRuntimeRegistry } from './runtimeRegistry'
import { purgeMatchRecords } from './purgeMatchRecords'

/**
 * 房间拆桌（全员离线 / 无 /game 连接）时，删除进行中的 Match 及子表，避免运营台幽灵对局。
 * 不推送 `game-invalidated`（客户端已断开）；与引擎 fatal rollback 区分。
 */
export async function abandonInProgressMatchOnTeardown(
  roomId: number,
  roomKey: string
): Promise<void> {
  const matchId = gameRuntimeRegistry.getCurrentMatchId(roomKey)
  if (matchId == null) return

  const row = await matchModel.findUnique({
    where: { id: matchId },
    select: { endedAt: true, roomId: true }
  })
  if (!row || row.endedAt != null || row.roomId !== roomId) return

  try {
    await purgeMatchRecords(matchId)
    try {
      gameRuntimeRegistry.getOrThrow(roomKey).currentMatchId = null
    } catch {
      // runtime may already be torn down
    }
    const { clearPlayerTurnTimeout } = await import(
      './texasDomain/playerTurnTimeoutScheduler'
    )
    clearPlayerTurnTimeout(roomKey)
    logger.info(
      `[match-abandon] purged in-progress match ${matchId} for room ${roomId} on teardown`
    )
  } catch (e) {
    logger.error(
      `[match-abandon] purge failed roomId=${roomId} matchId=${matchId}`,
      e
    )
  }
}
