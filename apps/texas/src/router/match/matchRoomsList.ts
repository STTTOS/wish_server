import type { RoomTableType } from '../../constants/game'

import dayjs from 'dayjs'
import { Prisma } from '@prisma/texas-client'

import { timeFormat } from '../../config'
import prisma, { playerMatchRecord } from '../../models'

export type MatchRoomsListParams = {
  targetUserId: number
  current: number
  pageSize: number
  tableType?: RoomTableType
}

export type MatchRoomsListItem = {
  roomId: number
  roomCode: string
  lowestBetAmount: number
  initialChips: number
  thinkingTime: number
  isPrivate: boolean
  tableType: RoomTableType
  sevenTwoBonusEnabled: boolean
  lastMatchAt: string
  matchCount: number
  playerCount: number
  players: Array<{
    userId: number
    avatarKey: string | null
    avatarUrl: string | null
  }>
  totalWager: number
  totalBetAmount: number
  avgBetAmount: number
}

export type MatchRoomsListResult = {
  total: number
  list: MatchRoomsListItem[]
}

type RoomIdPageRow = { roomId: number; lastMatchAt: Date }

type RoomAgg = {
  roomId: number
  matchCount: number
  totalWager: number
  totalBetAmount: number
  lastMatchAt: Date
  room: {
    activeCode: string | null
    lowestBetAmount: number
    initialChips: number
    thinkingTime: number
    isPrivate: boolean
    tableType: RoomTableType
    sevenTwoBonusEnabled: boolean
  }
}

type RoomPlayer = {
  userId: number
  avatarKey: string | null
  avatarUrl: string | null
  lastAt: number
}

/**
 * 按用户聚合参与过的房间列表（分页）。
 * 权威源：`PlayerMatchRecord`（非 `UserRoomStat`）。
 */
export async function fetchMatchRoomsList(
  params: MatchRoomsListParams
): Promise<MatchRoomsListResult> {
  const { targetUserId, current, pageSize, tableType } = params
  const skip = (current - 1) * pageSize
  const take = pageSize
  const tableTypeFilter = tableType
    ? Prisma.sql`AND r.tableType = ${tableType}`
    : Prisma.empty

  const [pageRows, countRows] = await Promise.all([
    prisma.$queryRaw<RoomIdPageRow[]>`
      SELECT
        m.roomId AS roomId,
        MAX(COALESCE(m.endedAt, m.startedAt, m.createdAt)) AS lastMatchAt
      FROM PlayerMatchRecord pmr
      INNER JOIN \`Match\` m ON m.id = pmr.matchId
      INNER JOIN Room r ON r.id = m.roomId
      WHERE pmr.userId = ${targetUserId}
      ${tableTypeFilter}
      GROUP BY m.roomId
      ORDER BY lastMatchAt DESC
      LIMIT ${take} OFFSET ${skip}
    `,
    prisma.$queryRaw<Array<{ cnt: bigint | number }>>`
      SELECT COUNT(*) AS cnt FROM (
        SELECT m.roomId
        FROM PlayerMatchRecord pmr
        INNER JOIN \`Match\` m ON m.id = pmr.matchId
        INNER JOIN Room r ON r.id = m.roomId
        WHERE pmr.userId = ${targetUserId}
        ${tableTypeFilter}
        GROUP BY m.roomId
      ) t
    `
  ])

  const total = Number(countRows[0]?.cnt ?? 0)
  const roomIds = pageRows.map((r) => r.roomId)
  if (roomIds.length === 0) {
    return { total, list: [] }
  }

  const [records, sides] = await Promise.all([
    playerMatchRecord.findMany({
      where: {
        userId: targetUserId,
        match: { roomId: { in: roomIds } }
      },
      select: {
        wager: true,
        totalBetAmount: true,
        match: {
          select: {
            roomId: true,
            endedAt: true,
            startedAt: true,
            createdAt: true,
            room: {
              select: {
                activeCode: true,
                lowestBetAmount: true,
                initialChips: true,
                thinkingTime: true,
                isPrivate: true,
                tableType: true,
                sevenTwoBonusEnabled: true
              }
            }
          }
        }
      }
    }),
    playerMatchRecord.findMany({
      where: { match: { roomId: { in: roomIds } } },
      select: {
        userId: true,
        user: { select: { avatarKey: true, avatarUrl: true } },
        match: {
          select: {
            roomId: true,
            endedAt: true,
            startedAt: true,
            createdAt: true
          }
        }
      }
    })
  ])

  const byRoom = new Map<number, RoomAgg>()
  for (const row of records) {
    const rid = row.match.roomId
    const at =
      row.match.endedAt ??
      row.match.startedAt ??
      row.match.createdAt ??
      new Date(0)
    const prev = byRoom.get(rid)
    if (!prev) {
      byRoom.set(rid, {
        roomId: rid,
        matchCount: 1,
        totalWager: Number(row.wager ?? 0),
        totalBetAmount: Number(row.totalBetAmount ?? 0),
        lastMatchAt: at,
        room: row.match.room
      })
      continue
    }
    prev.matchCount += 1
    prev.totalWager += Number(row.wager ?? 0)
    prev.totalBetAmount += Number(row.totalBetAmount ?? 0)
    if (at.getTime() > prev.lastMatchAt.getTime()) {
      prev.lastMatchAt = at
    }
  }

  const playersByRoom = new Map<number, Map<number, RoomPlayer>>()
  for (const side of sides) {
    const rid = side.match.roomId
    const at = (
      side.match.endedAt ??
      side.match.startedAt ??
      side.match.createdAt ??
      new Date(0)
    ).getTime()
    let byUser = playersByRoom.get(rid)
    if (!byUser) {
      byUser = new Map()
      playersByRoom.set(rid, byUser)
    }
    const prev = byUser.get(side.userId)
    if (prev != null && prev.lastAt >= at) continue
    byUser.set(side.userId, {
      userId: side.userId,
      avatarKey: side.user.avatarKey ?? null,
      avatarUrl: side.user.avatarUrl ?? null,
      lastAt: at
    })
  }

  // 保持 SQL 分页顺序（按最近对局时间倒序）
  const list = roomIds
    .map((rid) => byRoom.get(rid))
    .filter((stat): stat is RoomAgg => stat != null)
    .map((stat) => {
      const matchCount = stat.matchCount
      const totalBetAmount = Math.round(stat.totalBetAmount)
      const players = Array.from(playersByRoom.get(stat.roomId)?.values() ?? [])
        .sort((a, b) => b.lastAt - a.lastAt)
        .map(({ userId, avatarKey, avatarUrl }) => ({
          userId,
          avatarKey,
          avatarUrl
        }))
      return {
        roomId: stat.roomId,
        roomCode: stat.room.activeCode ?? '',
        lowestBetAmount: stat.room.lowestBetAmount,
        initialChips: stat.room.initialChips,
        thinkingTime: stat.room.thinkingTime,
        isPrivate: stat.room.isPrivate,
        tableType: stat.room.tableType,
        sevenTwoBonusEnabled: stat.room.sevenTwoBonusEnabled,
        lastMatchAt: dayjs(stat.lastMatchAt).format(timeFormat),
        matchCount,
        playerCount: players.length,
        players,
        totalWager: stat.totalWager,
        totalBetAmount,
        avgBetAmount:
          matchCount > 0 ? Math.round(totalBetAmount / matchCount) : 0
      }
    })

  return { total, list }
}
