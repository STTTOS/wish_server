import type { MatchRollbackManager } from './types'
import type { Texas, RoleEnum } from 'texas-poker-core'

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
 * - 记录开局快照（仅服务端用于恢复 Texas 余额）
 * - 删除本手已落库数据（含 `RoomChipTopUp` 锚在本手 `Match.id` 的记录、`MatchDomainEvent` 等）
 * - 回滚 Texas 内存余额
 * - 推送 `game-invalidated`（无 `players`；客户端应 toast 并回首页）
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
        source: 'engine_error'
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
