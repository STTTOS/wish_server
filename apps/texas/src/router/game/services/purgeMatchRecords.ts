import {
  match,
  betRecord,
  roomChipTopUp,
  matchDomainEvent,
  playerMatchRecord,
  matchStageTimeRecord
} from '../../../models'

/**
 * 物理删除一局 Match 及其子表（与引擎 fatal rollback、房间拆桌 abandon 共用）。
 * `RoomChipTopUp.afterMatchId` 为 Restrict，须先于 `match.delete`。
 */
export async function purgeMatchRecords(matchId: number): Promise<void> {
  await roomChipTopUp.deleteMany({ where: { afterMatchId: matchId } })
  await Promise.all([
    matchDomainEvent.deleteMany({ where: { matchId } }),
    matchStageTimeRecord.deleteMany({ where: { matchId } }),
    betRecord.deleteMany({ where: { matchId } }),
    playerMatchRecord.deleteMany({ where: { matchId } })
  ])
  await match.delete({ where: { id: matchId } })
}
