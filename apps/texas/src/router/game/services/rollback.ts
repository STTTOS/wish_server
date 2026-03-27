import type { MatchRollbackManager } from './types'
import type { Texas, RoleEnum } from 'texas-poker-core'

import { logger } from '../../../logger'
import {
  match,
  betRecord,
  matchError,
  playerMatchRecord,
  matchStageTimeRecord
} from '../../../models'

/**
 * 负责“对局作废”的完整生命周期：
 * - 记录开局快照
 * - 回滚数据库
 * - 回滚 Texas 内存余额
 * - 推送 game-invalidated
 */
export function createMatchRollbackManager(params: {
  texas: Texas
  roomId: number
  roomKey: string
  runtimeRegistry: import('./runtimeRegistry').GameRuntimeRegistry
  wsGateway: import('./gameWsGateway').GameWsGateway
}): MatchRollbackManager {
  const { texas, roomId, roomKey, runtimeRegistry, wsGateway } = params
  const invalidatedMatchIds = new Set<number>()
  const matchStartSnapshots = new Map<
    number,
    Array<{ userId: number; role: RoleEnum | null; balance: number }>
  >()

  const snapshotPlayersAtHandStart = (matchId: number) => {
    const players = texas.room.getPlayersBySeatStatus('on-set')
    const snapshot = players.map((p) => ({
      userId: p.getUserInfo().id,
      role: p.getRole() ?? null,
      balance: p.balance
    }))
    matchStartSnapshots.set(matchId, snapshot)
  }

  const invalidateAndRollbackMatch = async (
    source: 'engine_error' | 'insufficient_players',
    reason: string
  ) => {
    const matchIdToInvalidate =
      runtimeRegistry.getOrThrow(roomKey).currentMatchId
    if (!matchIdToInvalidate || invalidatedMatchIds.has(matchIdToInvalidate))
      return
    invalidatedMatchIds.add(matchIdToInvalidate)

    try {
      await Promise.all([
        matchStageTimeRecord.deleteMany({
          where: { matchId: matchIdToInvalidate }
        }),
        betRecord.deleteMany({ where: { matchId: matchIdToInvalidate } }),
        playerMatchRecord.deleteMany({
          where: { matchId: matchIdToInvalidate }
        }),
        matchError.deleteMany({ where: { matchId: matchIdToInvalidate } })
      ])
      await match.delete({ where: { id: matchIdToInvalidate } })
    } catch (rollbackErr) {
      logger.error('[match-invalidated] rollback failed', rollbackErr)
    }

    const snapshot = matchStartSnapshots.get(matchIdToInvalidate)
    if (snapshot) {
      snapshot.forEach((s) => {
        const player = texas.room.getPlayerById(s.userId)
        if (player) player.balance = s.balance
      })
    } else {
      logger.error(
        `[match-invalidated] missing start snapshot, matchId=${matchIdToInvalidate}`
      )
    }

    wsGateway.notifyGameInvalidated(
      {
        roomId,
        matchId: matchIdToInvalidate,
        reason,
        source,
        players:
          snapshot ??
          texas.room.getPlayersBySeatStatus('on-set').map((p) => ({
            userId: p.getUserInfo().id,
            role: p.getRole() ?? null,
            balance: p.balance
          }))
      },
      roomKey
    )
    matchStartSnapshots.delete(matchIdToInvalidate)
  }

  return {
    snapshotPlayersAtHandStart,
    invalidateAndRollbackMatch,
    clearInvalidatedFlag(matchId: number) {
      invalidatedMatchIds.delete(matchId)
    },
    clearSnapshot(matchId: number) {
      matchStartSnapshots.delete(matchId)
    }
  }
}
