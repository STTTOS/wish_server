/* eslint-disable no-console */

/**
 * 按 MatchDomainEvent 回填 BetRecord.source（blind | action）。
 *
 * 迁移默认 source=action；本脚本把盲注类事件对齐的 BetRecord 标为 blind。
 *
 *   cd apps/texas
 *   npx ts-node --transpile-only scripts/backfillBetRecordSource.ts
 * 默认仅打印；写入：
 *   npx ts-node --transpile-only scripts/backfillBetRecordSource.ts --apply
 *
 * 回填后再跑：
 *   npm run backfill:style-stats
 */
import prisma from '../src/models'

const BLIND_EVENT_TYPES = ['BlindsPosted', 'PostedJoiningBigBlinds'] as const

const apply = process.argv.includes('--apply')
const batchSize = 500

type BlindEventRow = {
  id: number
  matchId: number
  handId: string | null
  seq: number
  eventType: string
  payload: unknown
}

const postsUserIds = (payload: unknown): number[] => {
  if (payload == null || typeof payload !== 'object') return []
  const posts = (payload as { posts?: unknown }).posts
  if (!Array.isArray(posts)) return []
  const ids: number[] = []
  for (const p of posts) {
    if (p != null && typeof p === 'object' && 'userId' in p) {
      const uid = (p as { userId: unknown }).userId
      if (typeof uid === 'number') ids.push(uid)
    }
  }
  return ids
}

const main = async () => {
  console.log(
    `[backfillBetRecordSource] mode=${
      apply ? 'APPLY' : 'dry-run'
    } batchSize=${batchSize}`
  )

  let cursor = 0
  let eventCount = 0
  let updatedRows = 0
  let missingHandId = 0
  let noBetRows = 0
  let userMismatch = 0

  for (;;) {
    const events: BlindEventRow[] = await prisma.matchDomainEvent.findMany({
      where: {
        id: { gt: cursor },
        eventType: { in: [...BLIND_EVENT_TYPES] }
      },
      orderBy: { id: 'asc' },
      take: batchSize,
      select: {
        id: true,
        matchId: true,
        handId: true,
        seq: true,
        eventType: true,
        payload: true
      }
    })
    if (events.length === 0) break

    for (const ev of events) {
      eventCount += 1
      cursor = ev.id

      if (ev.handId == null || ev.handId === '') {
        missingHandId += 1
        console.warn(
          `[warn] event id=${ev.id} matchId=${ev.matchId} type=${ev.eventType} missing handId`
        )
        continue
      }

      const expectedUserIds = postsUserIds(ev.payload)
      const where = {
        matchId: ev.matchId,
        domainHandId: ev.handId,
        domainEventSeq: ev.seq
      }

      const existing = await prisma.betRecord.findMany({
        where,
        select: { id: true, userId: true, source: true }
      })

      if (existing.length === 0) {
        noBetRows += 1
        console.warn(
          `[warn] no BetRecord for ${ev.eventType} matchId=${ev.matchId} handId=${ev.handId} seq=${ev.seq}`
        )
        continue
      }

      const foundIds = new Set(existing.map((r) => r.userId))
      const expectedSet = new Set(expectedUserIds)
      if (
        expectedUserIds.length > 0 &&
        (foundIds.size !== expectedSet.size ||
          [...expectedSet].some((id) => !foundIds.has(id)))
      ) {
        userMismatch += 1
        console.warn(
          `[warn] user mismatch matchId=${ev.matchId} handId=${ev.handId} seq=${
            ev.seq
          } expected=[${[...expectedSet].join(',')}] found=[${[
            ...foundIds
          ].join(',')}]`
        )
      }

      const needUpdate = existing.filter((r) => r.source !== 'blind')
      if (needUpdate.length === 0) continue

      if (apply) {
        const result = await prisma.betRecord.updateMany({
          where: {
            id: { in: needUpdate.map((r) => r.id) }
          },
          data: { source: 'blind' }
        })
        updatedRows += result.count
      } else {
        updatedRows += needUpdate.length
      }
    }

    console.log(
      `[progress] cursor=${cursor} events=${eventCount} wouldUpdateOrUpdated=${updatedRows}`
    )
  }

  console.log(
    JSON.stringify(
      {
        mode: apply ? 'APPLY' : 'dry-run',
        eventCount,
        updatedRows,
        missingHandId,
        noBetRows,
        userMismatch
      },
      null,
      2
    )
  )

  if (!apply) {
    console.log('dry-run only; re-run with --apply to write')
  }

  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
