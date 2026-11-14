import type {
  WsMatchWagerCurve,
  WsPlayerProfileItem,
  WsMatchWagerCurveSeriesItem
} from '@wishufree/texas-ws-contract'

import prisma from '../../../models'

/**
 * 本房按局累计 wager 曲线（方案 C：共用 X；缺席 hold-last）。
 * 仅统计已结束对局，按 `Match.id` 升序作为 handIndex。
 */
export async function fetchMatchWagerCurveForRoom(
  roomId: number
): Promise<WsMatchWagerCurve> {
  const matches = await prisma.match.findMany({
    where: { roomId, endedAt: { not: null } },
    orderBy: { id: 'asc' },
    select: {
      id: true,
      playerMatchRecords: {
        select: { userId: true, wager: true }
      }
    }
  })

  const matchIds = matches.map((m) => m.id)
  const handCount = matchIds.length
  const userIdSet = new Set<number>()
  for (const m of matches) {
    for (const p of m.playerMatchRecords) {
      userIdSet.add(p.userId)
    }
  }
  const userIds = Array.from(userIdSet).sort((a, b) => a - b)

  const series: WsMatchWagerCurveSeriesItem[] = userIds.map((userId) => {
    const cumulatives: Array<number | null> = []
    const participated: boolean[] = []
    let cum: number | null = null
    for (const m of matches) {
      const row = m.playerMatchRecords.find((p) => p.userId === userId)
      if (row != null) {
        cum = (cum ?? 0) + (Number(row.wager) || 0)
        cumulatives.push(cum)
        participated.push(true)
      } else if (cum != null) {
        cumulatives.push(cum)
        participated.push(false)
      } else {
        cumulatives.push(null)
        participated.push(false)
      }
    }
    return { userId, cumulatives, participated }
  })

  const users =
    userIds.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: userIds } },
          select: {
            id: true,
            name: true,
            avatarUrl: true,
            avatarKey: true,
            pokerBackgroundKey: true
          }
        })
      : []
  const profileById = new Map(users.map((u) => [u.id, u]))
  const playerProfiles: WsPlayerProfileItem[] = userIds.map((userId) => {
    const p = profileById.get(userId)
    return {
      userId,
      name: p?.name ?? `玩家${userId}`,
      avatarUrl: p?.avatarUrl ?? null,
      avatarKey: p?.avatarKey ?? 'cartoon/default',
      pokerBackgroundKey: p?.pokerBackgroundKey ?? 'default'
    }
  })

  return {
    roomId,
    handCount,
    matchIds,
    series,
    playerProfiles
  }
}
