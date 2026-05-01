import type { MatchRollbackManager } from './types'

import { logger } from '../../../logger'
import {
  match,
  betRecord,
  roomChipTopUp,
  matchDomainEvent,
  playerMatchRecord,
  matchStageTimeRecord
} from '../../../models'

/**
 * 负责「引擎致命错误」下本手作废：
 * - 删除本手已落库数据（含 `RoomChipTopUp` 锚在本手 `Match.id` 的记录、`MatchDomainEvent` 等）
 * - 推送 `game-invalidated`（无 `players`；客户端应 toast 并回首页）
 */
export function createMatchRollbackManager(params: {
  roomId: number
  roomKey: string
  runtimeRegistry: import('./runtimeRegistry').GameRuntimeRegistry
  wsGateway: import('./gameWsGateway').GameWsGateway
}): MatchRollbackManager {
  const { roomId, roomKey, runtimeRegistry, wsGateway } = params
  const invalidatedMatchIds = new Set<number>()

  const invalidateAndRollbackMatch = async (reason: string) => {
    const runtime = runtimeRegistry.getOrThrow(roomKey)
    const matchIdToInvalidate = runtime.currentMatchId
    if (
      matchIdToInvalidate == null ||
      invalidatedMatchIds.has(matchIdToInvalidate)
    )
      return
    invalidatedMatchIds.add(matchIdToInvalidate)

    try {
      await roomChipTopUp.deleteMany({
        where: { afterMatchId: matchIdToInvalidate }
      })
      await Promise.all([
        matchDomainEvent.deleteMany({
          where: { matchId: matchIdToInvalidate }
        }),
        matchStageTimeRecord.deleteMany({
          where: { matchId: matchIdToInvalidate }
        }),
        betRecord.deleteMany({ where: { matchId: matchIdToInvalidate } }),
        playerMatchRecord.deleteMany({
          where: { matchId: matchIdToInvalidate }
        })
      ])
      await match.delete({ where: { id: matchIdToInvalidate } })
      runtime.currentMatchId = null
    } catch (rollbackErr) {
      logger.error('[match-invalidated] rollback failed', rollbackErr)
    }

    wsGateway.notifyGameInvalidated(
      {
        roomId,
        matchId: matchIdToInvalidate,
        reason,
        source: 'engine_error'
      },
      roomKey
    )
  }

  return {
    invalidateAndRollbackMatch,
    clearInvalidatedFlag(matchId: number) {
      invalidatedMatchIds.delete(matchId)
    }
  }
}
