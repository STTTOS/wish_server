import type { Prisma } from '@prisma/texas-client'
import type { TexasDomainEvent } from 'texas-poker-core'

import { toPersistedDomainEventRows } from 'texas-poker-core'

import { matchDomainEvent } from '../../../../models'

export type AppendMatchDomainEventTapeParams = Readonly<{
  matchId: number
  roomId: number
  event: TexasDomainEvent
}>

/**
 * 与 texas-poker-core 磁带行语义对齐：`handId` / `seq` / `eventType` / `payloadJson` 等价字段写入 Prisma。
 */
export async function appendMatchDomainEventTape(
  params: AppendMatchDomainEventTapeParams
): Promise<void> {
  const { matchId, roomId, event } = params
  const [row] = toPersistedDomainEventRows(String(matchId), [event])
  await matchDomainEvent.create({
    data: {
      matchId,
      roomId,
      handId: row.handId,
      seq: row.seq,
      eventType: row.eventType,
      payload: JSON.parse(row.payloadJson) as Prisma.InputJsonValue
    }
  })
}
