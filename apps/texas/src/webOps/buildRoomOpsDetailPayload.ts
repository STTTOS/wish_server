import formatTime from '../utils/formatTime'
import {
  room,
  user,
  match,
  roomMember,
  roomChipTopUp,
  playerMatchRecord
} from '../models'

export type RoomOpsDetailPlayerRow = {
  userId: number
  name: string
  username: string
  avatarUrl: string | null
  avatarKey: string
  /** 该房间所有对局 `PlayerMatchRecord.wager` 之和（总输赢） */
  totalWager: number
  /** 该房间所有对局 `PlayerMatchRecord.totalBetAmount` 之和（总下注） */
  totalBetAmount: number
  /** 该房间 `RoomChipTopUp.amount` 之和 */
  totalTopUpAmount: number
}

export type RoomOpsDetailPayload = {
  room: {
    id: number
    activeCode: string | null
    gameStatus: string
    lowestBetAmount: number
    initialChips: number
    tableType: string
    thinkingTime: number
    isPrivate: boolean
    sevenTwoBonusEnabled: boolean
    createdAt: string | null
    deletedAt: string | null
    matchCount: number
    /** 当前仍在 `RoomMember` 中的用户数 */
    memberCount: number
    /** 曾出现在本房间的去重用户：当前成员 ∪ 有对局记录 ∪ 有补码记录 */
    historicalMemberCount: number
    /** 各已结束对局 `(endedAt - startedAt)` 之和，单位：秒 */
    totalGameDurationSec: number
    /** 全房间 `Match.totalBetAmount` 之和 */
    totalRoomBetAmount: number
    owner: {
      id: number
      name: string
      username: string
      avatarUrl: string | null
      avatarKey: string
    }
  }
  players: RoomOpsDetailPlayerRow[]
}

/**
 * 管理端房间「对局汇总」详情：房间基本信息 + 按用户聚合输赢、下注与补码。
 */
export async function buildRoomOpsDetailPayload(
  roomId: number
): Promise<RoomOpsDetailPayload | null> {
  const row = await room.findFirst({
    where: { id: roomId },
    include: {
      owner: {
        select: {
          id: true,
          name: true,
          username: true,
          avatarUrl: true,
          avatarKey: true
        }
      },
      _count: { select: { members: true, Match: true } }
    }
  })
  if (!row) return null

  const [
    wagerAgg,
    topUpAgg,
    endedMatches,
    roomBetAgg,
    pmrUserRows,
    topUpUserRows,
    memberUserRows
  ] = await Promise.all([
    playerMatchRecord.groupBy({
      by: ['userId'],
      where: { match: { roomId } },
      _sum: { wager: true, totalBetAmount: true }
    }),
    roomChipTopUp.groupBy({
      by: ['userId'],
      where: { roomId },
      _sum: { amount: true }
    }),
    match.findMany({
      where: {
        roomId,
        startedAt: { not: null },
        endedAt: { not: null }
      },
      select: { startedAt: true, endedAt: true }
    }),
    match.aggregate({
      where: { roomId },
      _sum: { totalBetAmount: true }
    }),
    playerMatchRecord.findMany({
      where: { match: { roomId } },
      distinct: ['userId'],
      select: { userId: true }
    }),
    roomChipTopUp.findMany({
      where: { roomId },
      distinct: ['userId'],
      select: { userId: true }
    }),
    roomMember.findMany({
      where: { roomId },
      select: { userId: true }
    })
  ])

  let totalGameDurationSec = 0
  for (const m of endedMatches) {
    if (m.startedAt && m.endedAt) {
      totalGameDurationSec += Math.max(
        0,
        Math.floor((m.endedAt.getTime() - m.startedAt.getTime()) / 1000)
      )
    }
  }

  const historicalUserIds = new Set<number>()
  for (const r of pmrUserRows) historicalUserIds.add(r.userId)
  for (const r of topUpUserRows) historicalUserIds.add(r.userId)
  for (const r of memberUserRows) historicalUserIds.add(r.userId)

  const wagerByUser = new Map<number, number>()
  const betByUser = new Map<number, number>()
  for (const r of wagerAgg) {
    wagerByUser.set(r.userId, Number(r._sum.wager ?? 0))
    betByUser.set(r.userId, Number(r._sum.totalBetAmount ?? 0))
  }
  const topUpByUser = new Map<number, number>()
  for (const r of topUpAgg) {
    topUpByUser.set(r.userId, Number(r._sum.amount ?? 0))
  }

  const userIds = [
    ...new Set<number>([
      ...wagerByUser.keys(),
      ...betByUser.keys(),
      ...topUpByUser.keys()
    ])
  ]

  const users =
    userIds.length === 0
      ? []
      : await user.findMany({
          where: { id: { in: userIds } },
          select: {
            id: true,
            name: true,
            username: true,
            avatarUrl: true,
            avatarKey: true
          }
        })

  const players: RoomOpsDetailPlayerRow[] = users
    .map((u) => ({
      userId: u.id,
      name: u.name,
      username: u.username,
      avatarUrl: u.avatarUrl,
      avatarKey: u.avatarKey,
      totalWager: wagerByUser.get(u.id) ?? 0,
      totalBetAmount: betByUser.get(u.id) ?? 0,
      totalTopUpAmount: topUpByUser.get(u.id) ?? 0
    }))
    .sort((a, b) => Math.abs(b.totalWager) - Math.abs(a.totalWager))

  return {
    room: {
      id: row.id,
      activeCode: row.activeCode,
      gameStatus: row.gameStatus,
      lowestBetAmount: row.lowestBetAmount,
      initialChips: row.initialChips,
      tableType: row.tableType,
      thinkingTime: row.thinkingTime,
      isPrivate: row.isPrivate,
      sevenTwoBonusEnabled: row.sevenTwoBonusEnabled,
      createdAt: formatTime(row.createdAt),
      deletedAt: formatTime(row.deletedAt),
      matchCount: row._count.Match,
      memberCount: row._count.members,
      historicalMemberCount: historicalUserIds.size,
      totalGameDurationSec,
      totalRoomBetAmount: Number(roomBetAgg._sum.totalBetAmount ?? 0),
      owner: row.owner
    },
    players
  }
}
