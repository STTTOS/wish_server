import type {
  TexasDomainEvent,
  PersistedDomainEventRow
} from 'texas-poker-core'

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

export type MatchReplayTapePayload = Readonly<{
  tape: PersistedDomainEventRow[]
  tapeIssues: ReturnType<typeof validatePersistedDomainEventRows>
}>

function sanitizeReplayEventForViewer(
  event: TexasDomainEvent,
  viewerUserId: number
): TexasDomainEvent {
  if (event.type !== 'HoleCardsDealt') return event
  const byUserId = Object.fromEntries(
    Object.entries(event.payload.byUserId).map(([uid, pokes]) => {
      const numericUid = Number(uid)
      return [uid, numericUid === viewerUserId ? pokes : []]
    })
  )
  return {
    ...event,
    payload: {
      ...event.payload,
      byUserId
    }
  }
}

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

/**
 * 面向 App 回放：返回按 DB 追加顺序排序的磁带行，并按 viewer 脱敏 HoleCardsDealt。
 */
export async function loadMatchReplayTapeForViewer(
  matchId: number,
  viewerUserId: number
): Promise<MatchReplayTapePayload> {
  const dbRows = await matchDomainEvent.findMany({
    where: { matchId },
    orderBy: { id: 'asc' }
  })
  const tableId = String(matchId)
  const tape: PersistedDomainEventRow[] = dbRows.map((row) => {
    const event = row.payload as TexasDomainEvent
    const viewerEvent = sanitizeReplayEventForViewer(event, viewerUserId)
    return {
      tableId,
      handId: row.handId,
      seq: row.seq,
      eventType: row.eventType as PersistedDomainEventRow['eventType'],
      payloadJson: JSON.stringify(viewerEvent),
      recordedAtMs: row.createdAt.getTime()
    }
  })
  return {
    tape,
    tapeIssues: validatePersistedDomainEventRows(tape)
  }
}
