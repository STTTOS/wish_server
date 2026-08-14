/**
 * 轻量采价事件日志：失败 / skip，合并重复短窗，便于查断档。
 * 成功 tick 不写。
 */
import prisma from '../models'
import { logger } from '../logger'

const COALESCE_MS = 60_000
const RETAIN_MS = 7 * 24 * 60 * 60 * 1000
let lastPruneAt = 0

export type PollLogKind = 'error' | 'skip';

export async function recordPollEvent(kind: PollLogKind, message: string) {
  const now = Date.now()
  const msg = message.slice(0, 500)
  try {
    const latest = await prisma.pollLog.findFirst({
      orderBy: { lastTs: 'desc' }
    })
    if (
      latest &&
      latest.kind === kind &&
      latest.message === msg &&
      now - Number(latest.lastTs) <= COALESCE_MS
    ) {
      await prisma.pollLog.update({
        where: { id: latest.id },
        data: {
          count: latest.count + 1,
          lastTs: BigInt(now)
        }
      })
    } else {
      await prisma.pollLog.create({
        data: {
          ts: BigInt(now),
          lastTs: BigInt(now),
          kind,
          message: msg,
          count: 1
        }
      })
    }

    if (now - lastPruneAt > 60 * 60 * 1000) {
      lastPruneAt = now
      const cutoff = BigInt(now - RETAIN_MS)
      await prisma.pollLog.deleteMany({ where: { lastTs: { lt: cutoff } } })
    }
  } catch (err) {
    logger.warn('pollLog write failed', err)
  }
}

export async function listPollLogs(opts?: {
  limit?: number;
  kind?: PollLogKind;
}) {
  const limit = Math.min(200, Math.max(1, opts?.limit ?? 50))
  const where = opts?.kind ? { kind: opts.kind } : {}
  const rows = await prisma.pollLog.findMany({
    where,
    orderBy: { lastTs: 'desc' },
    take: limit
  })
  return rows.map((r) => ({
    id: Number(r.id),
    ts: Number(r.ts),
    lastTs: Number(r.lastTs),
    kind: r.kind,
    message: r.message,
    count: r.count
  }))
}
