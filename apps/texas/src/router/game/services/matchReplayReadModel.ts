import type { PersistedDomainEventRow } from 'texas-poker-core'

import {
  projectCompositeReadModel,
  domainEventsFromPersistedRows,
  validatePersistedDomainEventRows
} from 'texas-poker-core'

import { matchDomainEvent } from '../../../models'

export type MatchDomainEventTapeReplayResult = Readonly<{
  tapeIssues: ReturnType<typeof validatePersistedDomainEventRows>
  compositeReadModel: ReturnType<typeof projectCompositeReadModel>
}>

/**
 * 按 DB 追加顺序读出 `MatchDomainEvent`，还原为 Core 磁带行后做结构校验并投影复合读模型。
 * `tableId` 与落盘约定一致：`String(matchId)`。
 */
export async function loadMatchCompositeReadModelFromDbTape(
  matchId: number
): Promise<MatchDomainEventTapeReplayResult> {
  const dbRows = await matchDomainEvent.findMany({
    where: { matchId },
    orderBy: { id: 'asc' }
  })
  const tableId = String(matchId)
  const persisted: PersistedDomainEventRow[] = dbRows.map((r) => ({
    tableId,
    handId: r.handId,
    seq: r.seq,
    eventType: r.eventType as PersistedDomainEventRow['eventType'],
    payloadJson: JSON.stringify(r.payload)
  }))
  const tapeIssues = validatePersistedDomainEventRows(persisted)
  const events = domainEventsFromPersistedRows(persisted)
  return {
    tapeIssues,
    compositeReadModel: projectCompositeReadModel(events)
  }
}
