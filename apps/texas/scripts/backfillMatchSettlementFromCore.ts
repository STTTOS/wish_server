/* eslint-disable no-console */

/**
 * 使用 texas-poker-core 重算已结束对局的牌力与奖池分配，并回写 Prisma。
 *
 * 范围：match.id >= MIN_ID 且 endedAt != null（排除进行中对局）。
 *
 * 在 apps/texas 目录执行（依赖根目录 node_modules 的 texas-poker-core）：
 *   npx ts-node --transpile-only scripts/backfillMatchSettlementFromCore.ts
 * 默认仅打印；写入数据库：
 *   npx ts-node --transpile-only scripts/backfillMatchSettlementFromCore.ts --apply
 */
import type { Poke, User, RankCategory } from 'texas-poker-core'

import { Texas, RoleEnum, type Player } from 'texas-poker-core'
import {
  Prisma,
  type Room,
  type Match,
  type PlayerMatchRecord,
  type RankCategory as PrismaRankCategory
} from '@prisma/texas-client'
import {
  getBestRankInfo,
  getBestFiveCards,
  getFiveCardsRankSignature,
  getStrengthFromRankSignature
} from 'texas-poker-core/dist/Deck/core'

import prisma, {
  user,
  match,
  roomChipTopUp,
  playerMatchRecord
} from '../src/models'

const MIN_MATCH_ID = 1950

/** 与 core `playerRoleSetMap` 顺时针一致：从 BTN 起的下一座位为 SB … */
const ROLE_RING_BY_COUNT: Record<number, RoleEnum[]> = {
  1: [RoleEnum.BTN],
  2: [RoleEnum.BTN, RoleEnum.BB],
  3: [RoleEnum.BTN, RoleEnum.SB, RoleEnum.BB],
  4: [RoleEnum.BTN, RoleEnum.SB, RoleEnum.BB, RoleEnum.UTG],
  5: [RoleEnum.BTN, RoleEnum.SB, RoleEnum.BB, RoleEnum.UTG, RoleEnum.MP],
  6: [
    RoleEnum.BTN,
    RoleEnum.SB,
    RoleEnum.BB,
    RoleEnum.UTG,
    RoleEnum.MP,
    RoleEnum.CO
  ],
  7: [
    RoleEnum.BTN,
    RoleEnum.SB,
    RoleEnum.BB,
    RoleEnum.UTG,
    RoleEnum.MP,
    RoleEnum.HJ,
    RoleEnum.CO
  ],
  8: [
    RoleEnum.BTN,
    RoleEnum.SB,
    RoleEnum.BB,
    RoleEnum.UTG,
    RoleEnum.MP,
    RoleEnum.LJ,
    RoleEnum.HJ,
    RoleEnum.CO
  ],
  9: [
    RoleEnum.BTN,
    RoleEnum.SB,
    RoleEnum.BB,
    RoleEnum.UTG,
    RoleEnum.UTG1,
    RoleEnum.MP,
    RoleEnum.LJ,
    RoleEnum.HJ,
    RoleEnum.CO
  ],
  10: [
    RoleEnum.BTN,
    RoleEnum.SB,
    RoleEnum.BB,
    RoleEnum.UTG,
    RoleEnum.UTG1,
    RoleEnum.UTG2,
    RoleEnum.MP,
    RoleEnum.LJ,
    RoleEnum.HJ,
    RoleEnum.CO
  ]
}

function parsePokesJson(raw: unknown): Poke[] {
  if (raw == null) return []
  if (!Array.isArray(raw)) return []
  return raw.filter((x): x is Poke => typeof x === 'string' && x.length >= 2)
}

function parseHoleCards(raw: unknown): [Poke, Poke] | null {
  const arr = parsePokesJson(raw)
  if (arr.length < 2) return null
  return [arr[0], arr[1]]
}

function rankCategoryFromSignature(
  sig: string | null | undefined
): RankCategory | null {
  if (sig == null || sig === '') return null
  const c = sig[0]
  const allowed = new Set(['z', 'y', 'x', 'w', 'v', 'u', 't', 's', 'r', 'q'])
  return allowed.has(c) ? (c as RankCategory) : null
}

function rankSignatureForDb(
  sig: string | object | undefined | null
): string | null {
  if (sig == null) return null
  if (typeof sig === 'string') return sig
  return JSON.stringify(sig)
}

function seatJoinOrder(pmrs: PlayerMatchRecord[]): PlayerMatchRecord[] {
  const n = pmrs.length
  const ring = ROLE_RING_BY_COUNT[n]
  if (!ring) {
    throw new Error(`unsupported player count ${n}`)
  }
  const byUser = new Map(pmrs.map((r) => [r.userId, r]))
  const btn = pmrs.find((r) => r.role === RoleEnum.BTN)
  if (!btn) throw new Error('missing btn role')
  const clockwiseFromBtn = [...ring.slice(1), ring[0]]
  const ordered: PlayerMatchRecord[] = []
  for (const role of clockwiseFromBtn) {
    const row = pmrs.find((r) => r.role === role)
    if (!row) throw new Error(`missing player with role ${role}`)
    if (!byUser.has(row.userId)) throw new Error(`unknown user ${row.userId}`)
    ordered.push(row)
  }
  return ordered
}

async function loadStartBalances(params: {
  roomId: number
  roomInitialChips: number
  matchId: number
  userIds: number[]
}): Promise<Map<number, number>> {
  const { roomId, roomInitialChips, matchId, userIds } = params
  const prev = await match.findMany({
    where: {
      roomId,
      id: { lt: matchId },
      endedAt: { not: null }
    },
    orderBy: { id: 'desc' },
    take: 1,
    select: { id: true }
  })
  const prevId = prev[0]?.id
  const out = new Map<number, number>()
  if (prevId == null) {
    for (const uid of userIds) out.set(uid, roomInitialChips)
    return out
  }
  const prevPmrs = await playerMatchRecord.findMany({
    where: { matchId: prevId },
    select: { userId: true, balanceAfterHand: true }
  })
  const prevBal = new Map<number, number>()
  for (const r of prevPmrs) {
    if (r.balanceAfterHand != null) {
      prevBal.set(r.userId, r.balanceAfterHand)
    }
  }
  const topUps = await roomChipTopUp.findMany({
    where: { roomId, afterMatchId: prevId }
  })
  const topByUser = new Map<number, number>()
  for (const t of topUps) {
    topByUser.set(t.userId, (topByUser.get(t.userId) ?? 0) + t.amount)
  }
  for (const uid of userIds) {
    const base = prevBal.has(uid) ? prevBal.get(uid)! : roomInitialChips
    const top = topByUser.get(uid) ?? 0
    out.set(uid, base + top)
  }
  return out
}

type RecomputedRow = {
  userId: number
  rankSignature: string | null
  rankStrength: number
  rankCategory: RankCategory | null
  wager: number
  balanceAfterHand: number
}

type RecomputedMatch = {
  bestPokes: unknown
  bestRankCategory: RankCategory | null
  rows: RecomputedRow[]
}

function findCorePlayer(texas: Texas, userId: number): Player {
  const p = texas.dealer.find((x) => x.getUserInfo().id === userId)
  if (!p) throw new Error(`core player missing userId=${userId}`)
  return p
}

function recomputeOneMatch(params: {
  m: Match & { room: Room }
  pmrs: PlayerMatchRecord[]
  users: Map<number, { name: string }>
  startBalanceByUser: Map<number, number>
}): RecomputedMatch {
  const { m, pmrs, users, startBalanceByUser } = params
  const common = parsePokesJson(m.commonPokes)
  if (common.length !== 3 && common.length !== 4 && common.length !== 5) {
    throw new Error(`commonPokes length ${common.length} not in 3..5`)
  }

  const joinOrder = seatJoinOrder(pmrs)
  const btnRow = pmrs.find((r) => r.role === RoleEnum.BTN)!
  const btnUser: User = {
    id: btnRow.userId,
    name: users.get(btnRow.userId)?.name ?? `u${btnRow.userId}`
  }

  const texas = new Texas({
    user: btnUser,
    lowestBetAmount: m.lowestBetAmount,
    maximumCountOfPlayers: Math.max(pmrs.length, 2),
    initialChips: m.room.initialChips
  })

  texas.room.seat(texas.room.owner)
  for (const row of joinOrder) {
    if (row.userId === btnRow.userId) continue
    const u: User = {
      id: row.userId,
      name: users.get(row.userId)?.name ?? `u${row.userId}`
    }
    const p = texas.createPlayer(u)
    texas.room.join(p)
    texas.room.seat(p)
  }

  for (const row of pmrs) {
    const p = findCorePlayer(texas, row.userId)
    const start = startBalanceByUser.get(row.userId)
    if (start == null || !Number.isFinite(start)) {
      throw new Error(`missing start balance userId=${row.userId}`)
    }
    const contrib = Math.round(Number(row.totalBetAmount) || 0)
    if (start < contrib) {
      throw new Error(
        `startBalance ${start} < totalBetAmount ${contrib} userId=${row.userId}`
      )
    }
    p.balance = start
    p.wager = 0
    p.totalBetAmount = 0
    p.currentStageTotalAmount = 0
  }

  texas.unlockSeats()
  texas.room.initialRoles(texas.room.owner)

  for (const row of pmrs) {
    const hole = parseHoleCards(row.handPokes)
    if (!hole) throw new Error(`userId=${row.userId} invalid handPokes`)
    const p = findCorePlayer(texas, row.userId)
    p.setHandPokes(hole)
  }

  const activePmrs = pmrs.filter((r) => !r.isFold)
  const handsForTableBest: Poke[][] = activePmrs.map((row) => {
    const hole = parseHoleCards(row.handPokes)
    if (!hole) throw new Error(`userId=${row.userId} invalid handPokes`)
    return hole
  })
  if (handsForTableBest.length === 0) {
    throw new Error('no non-folded players for table best')
  }
  const tableBest = getBestRankInfo(handsForTableBest, common)

  for (const row of pmrs) {
    const p = findCorePlayer(texas, row.userId)
    const hole = parseHoleCards(row.handPokes)!
    const best5 = getBestFiveCards(hole, common)
    const sig = getFiveCardsRankSignature(best5)
    const strength = getStrengthFromRankSignature(sig)
    const rankCategory = rankCategoryFromSignature(sig)
    if (!rankCategory) {
      throw new Error(
        `userId=${row.userId} invalid rank category signature=${sig}`
      )
    }
    p.setShowdownEval({
      bestFiveCards: best5,
      rankSignature: sig,
      rankStrength: strength,
      rankCategory
    })
    if (row.isFold) p.setStatus('out')
    else if (row.isAllIn) p.setStatus('allIn')
    else p.setStatus('eligible')
  }

  texas.pool.reset()
  for (const row of pmrs) {
    const contrib = Math.round(Number(row.totalBetAmount) || 0)
    if (contrib <= 0) continue
    const p = findCorePlayer(texas, row.userId)
    texas.pool.add(p, contrib)
  }

  texas.pool.pay()

  const rows: RecomputedRow[] = pmrs.map((row) => {
    const p = findCorePlayer(texas, row.userId)
    return {
      userId: row.userId,
      rankSignature: rankSignatureForDb(p.rankSignature),
      rankStrength: p.rankStrength,
      rankCategory: rankCategoryFromSignature(
        typeof p.rankSignature === 'string' ? p.rankSignature : undefined
      ),
      wager: p.wager,
      balanceAfterHand: Math.round(p.balance)
    }
  })

  return {
    bestPokes: tableBest.pokes as unknown,
    bestRankCategory: tableBest.rankCategory,
    rows
  }
}

function diffRow(
  row: PlayerMatchRecord,
  next: RecomputedRow
): Record<string, { before: unknown; after: unknown }> {
  const d: Record<string, { before: unknown; after: unknown }> = {}
  const rs = rankSignatureForDb(row.rankSignature as string | null)
  if (rs !== next.rankSignature) {
    d.rankSignature = { before: rs, after: next.rankSignature }
  }
  if (row.rankStrength !== next.rankStrength) {
    d.rankStrength = { before: row.rankStrength, after: next.rankStrength }
  }
  if (Number(row.wager) !== next.wager) {
    d.wager = { before: row.wager, after: next.wager }
  }
  if (row.rankCategory !== next.rankCategory) {
    d.rankCategory = { before: row.rankCategory, after: next.rankCategory }
  }
  return d
}

async function main() {
  const apply = process.argv.includes('--apply')
  const rows = await match.findMany({
    where: {
      id: { gte: MIN_MATCH_ID },
      endedAt: { not: null }
    },
    orderBy: { id: 'asc' },
    include: { room: true }
  })

  let processed = 0
  let updatedMatches = 0
  let skipped = 0

  for (const m of rows) {
    processed += 1
    const pmrs = await playerMatchRecord.findMany({
      where: { matchId: m.id },
      orderBy: { userId: 'asc' }
    })
    if (pmrs.length < 2) {
      console.log(
        `[backfill] SKIP matchId=${m.id} reason=less_than_2_player_records`
      )
      skipped += 1
      continue
    }

    const userIds = [...new Set(pmrs.map((p) => p.userId))]
    const usersRows = await user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true }
    })
    const users = new Map(usersRows.map((u) => [u.id, { name: u.name }]))

    let startBalanceByUser: Map<number, number>
    try {
      startBalanceByUser = await loadStartBalances({
        roomId: m.roomId,
        roomInitialChips: m.room.initialChips,
        matchId: m.id,
        userIds
      })
    } catch (e) {
      console.log(
        `[backfill] SKIP matchId=${m.id} reason=start_balance_load_failed`,
        String(e)
      )
      skipped += 1
      continue
    }

    let next: RecomputedMatch
    try {
      next = recomputeOneMatch({
        m: m as Match & { room: Room },
        pmrs,
        users,
        startBalanceByUser
      })
    } catch (e) {
      console.log(
        `[backfill] SKIP matchId=${m.id} reason=recompute_failed`,
        String(e)
      )
      skipped += 1
      continue
    }

    const oldBestCat = m.bestRankCategory
    const oldBestPokes = JSON.stringify(m.bestPokes ?? null)
    const newBestPokes = JSON.stringify(next.bestPokes ?? null)
    const matchMetaChanged =
      oldBestCat !== next.bestRankCategory || oldBestPokes !== newBestPokes

    const pmrDiffs: {
      matchId: number
      userId: number
      changes: Record<string, { before: unknown; after: unknown }>
    }[] = []

    for (const row of pmrs) {
      const nr = next.rows.find((r) => r.userId === row.userId)
      if (!nr) continue
      const ch = diffRow(row, nr)
      const balBefore = row.balanceAfterHand
      const balAfter = nr.balanceAfterHand
      if (balBefore !== balAfter) {
        ch.balanceAfterHand = { before: balBefore, after: balAfter }
      }
      if (Object.keys(ch).length > 0) {
        pmrDiffs.push({ matchId: m.id, userId: row.userId, changes: ch })
      }
    }

    if (!matchMetaChanged && pmrDiffs.length === 0) {
      continue
    }

    console.log(
      `[backfill] AFFECTED matchId=${m.id} roomId=${m.roomId} playerDiffs=${pmrDiffs.length} matchFieldsChanged=${matchMetaChanged}`
    )
    for (const d of pmrDiffs) {
      console.log(
        `[backfill]   PlayerMatchRecord matchId=${d.matchId} userId=${d.userId}`,
        JSON.stringify(d.changes)
      )
    }
    if (matchMetaChanged) {
      console.log(
        `[backfill]   Match bestRankCategory before=${oldBestCat} after=${next.bestRankCategory}`
      )
      console.log(
        `[backfill]   Match bestPokes changed=${oldBestPokes !== newBestPokes}`
      )
    }

    if (!apply) continue

    await prisma.$transaction(async (tx) => {
      for (const nr of next.rows) {
        await tx.playerMatchRecord.update({
          where: {
            matchId_userId: { matchId: m.id, userId: nr.userId }
          },
          data: {
            rankSignature: nr.rankSignature,
            rankStrength: nr.rankStrength,
            rankCategory: nr.rankCategory as PrismaRankCategory | null,
            wager: nr.wager,
            balanceAfterHand: nr.balanceAfterHand
          }
        })
      }
      await tx.match.update({
        where: { id: m.id },
        data: {
          bestPokes:
            next.bestPokes == null
              ? Prisma.JsonNull
              : (JSON.parse(
                  JSON.stringify(next.bestPokes)
                ) as Prisma.InputJsonValue),
          bestRankCategory: next.bestRankCategory
        }
      })
    })
    updatedMatches += 1
  }

  console.log(
    `[backfill] done processed=${processed} updatedMatches=${updatedMatches} skipped=${skipped} apply=${apply}`
  )
}

main()
  .catch((e) => {
    console.error('[backfill] fatal', e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
