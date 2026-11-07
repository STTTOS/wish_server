import type { Prisma } from '@prisma/texas-client'

import { clientConnectionEvent } from '../../models'

export type IngestConnectionEventInput = {
  clientEventId?: unknown
  clientSessionId?: unknown
  clientTs?: unknown
  kind?: unknown
  ns?: unknown
  roomId?: unknown
  matchId?: unknown
  platform?: unknown
  osVersion?: unknown
  appVersion?: unknown
  appState?: unknown
  netType?: unknown
  isConnected?: unknown
  reason?: unknown
  sinceSeq?: unknown
  afterSeq?: unknown
  throughSeq?: unknown
  latestSeq?: unknown
  eventCount?: unknown
  truncated?: unknown
  recovery?: unknown
  durationMs?: unknown
  expectedSeq?: unknown
  actualSeq?: unknown
  extra?: unknown
}

const MAX_BATCH = 80

function asTrimmedString(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const t = value.trim()
  if (!t) return null
  return t.length > max ? t.slice(0, max) : t
}

function asInt(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value)
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value)
    if (Number.isFinite(n)) return Math.trunc(n)
  }
  return null
}

function asBool(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value
  return null
}

function asClientTs(value: unknown): Date | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return new Date(value)
  }
  if (typeof value === 'string' && value.trim()) {
    const d = new Date(value)
    if (!Number.isNaN(d.getTime())) return d
  }
  return null
}

function sanitizeExtra(value: unknown): Prisma.InputJsonValue | undefined {
  if (value == null) return undefined
  if (typeof value !== 'object' || Array.isArray(value)) return undefined
  const out: Record<string, string | number | boolean | null> = {}
  let n = 0
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (n >= 20) break
    const key = k.slice(0, 40)
    if (
      typeof v === 'string' ||
      typeof v === 'number' ||
      typeof v === 'boolean' ||
      v === null
    ) {
      out[key] = typeof v === 'string' ? v.slice(0, 120) : v
      n += 1
    }
  }
  return out
}

/**
 * 批量写入连接质量事件；按 (userId, clientEventId) 幂等跳过重复。
 */
export async function ingestClientConnectionEvents(params: {
  userId: number
  events: IngestConnectionEventInput[]
}): Promise<{ accepted: number; skipped: number }> {
  const { userId } = params
  const slice = params.events.slice(0, MAX_BATCH)
  let accepted = 0
  let skipped = 0

  const rows: Prisma.ClientConnectionEventCreateManyInput[] = []
  for (const raw of slice) {
    const clientEventId = asTrimmedString(raw.clientEventId, 48)
    const clientSessionId = asTrimmedString(raw.clientSessionId, 48)
    const kind = asTrimmedString(raw.kind, 40)
    const clientTs = asClientTs(raw.clientTs)
    if (!clientEventId || !clientSessionId || !kind || !clientTs) {
      skipped += 1
      continue
    }
    rows.push({
      userId,
      source: 'client',
      clientEventId,
      clientSessionId,
      clientTs,
      kind,
      ns: asTrimmedString(raw.ns, 32),
      roomId: asInt(raw.roomId) ?? undefined,
      matchId: asInt(raw.matchId) ?? undefined,
      platform: asTrimmedString(raw.platform, 16),
      osVersion: asTrimmedString(raw.osVersion, 32),
      appVersion: asTrimmedString(raw.appVersion, 32),
      appState: asTrimmedString(raw.appState, 16),
      netType: asTrimmedString(raw.netType, 24),
      isConnected: asBool(raw.isConnected) ?? undefined,
      reason: asTrimmedString(raw.reason, 120),
      sinceSeq: asInt(raw.sinceSeq) ?? undefined,
      afterSeq: asInt(raw.afterSeq) ?? undefined,
      throughSeq: asInt(raw.throughSeq) ?? undefined,
      latestSeq: asInt(raw.latestSeq) ?? undefined,
      eventCount: asInt(raw.eventCount) ?? undefined,
      truncated: asBool(raw.truncated) ?? undefined,
      recovery: asTrimmedString(raw.recovery, 32),
      durationMs: asInt(raw.durationMs) ?? undefined,
      expectedSeq: asInt(raw.expectedSeq) ?? undefined,
      actualSeq: asInt(raw.actualSeq) ?? undefined,
      extra: sanitizeExtra(raw.extra)
    })
  }

  if (rows.length === 0) {
    return { accepted: 0, skipped }
  }

  const result = await clientConnectionEvent.createMany({
    data: rows,
    skipDuplicates: true
  })
  accepted = result.count
  skipped += rows.length - accepted
  return { accepted, skipped }
}

export { MAX_BATCH as CONNECTION_QUALITY_INGEST_MAX_BATCH }
