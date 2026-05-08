/**
 * 管理端看板汇总：聚合查询与按日序列，供 `router/opsWeb` 使用，路由层只做鉴权与响应。
 */
import dayjs from 'dayjs'

import formatTime from '../utils/formatTime'
import { room, match, engineFatalIncident } from '../models'

export type DashboardSummaryPayload = {
  rangeStart: string | null
  matchesEndedLast7d: number
  /** 历史累计：已结束对局（`endedAt` 非空） */
  matchesEndedTotal: number
  engineFatalsLast7d: number
  roomsInPlay: number
  roomsTotal: number
  matchesEndedToday: number
  engineFatalsToday: number
  dailySeries: { day: string; matchesEnded: number; engineFatals: number }[]
}

export async function buildDashboardSummary(): Promise<DashboardSummaryPayload> {
  const since = dayjs().subtract(7, 'day').startOf('day').toDate()
  const todayStart = dayjs().startOf('day').toDate()

  const dayRanges = Array.from({ length: 7 }, (_, i) => {
    const d = dayjs().subtract(6 - i, 'day')
    return {
      day: d.format('YYYY-MM-DD'),
      start: d.startOf('day').toDate(),
      end: d.endOf('day').toDate()
    }
  })

  const perDayCountPromises = dayRanges.flatMap(({ start, end }) => [
    match.count({
      where: { endedAt: { gte: start, lte: end } }
    }),
    engineFatalIncident.count({
      where: { createdAt: { gte: start, lte: end } }
    })
  ])

  const [
    matchesEndedLast7d,
    matchesEndedTotal,
    engineFatalsLast7d,
    roomsInPlay,
    roomsTotal,
    matchesEndedToday,
    engineFatalsToday,
    ...perDayCounts
  ] = await Promise.all([
    match.count({
      where: { endedAt: { gte: since } }
    }),
    match.count({
      where: { endedAt: { not: null } }
    }),
    engineFatalIncident.count({
      where: { createdAt: { gte: since } }
    }),
    room.count({
      where: {
        deletedAt: null,
        gameStatus: {
          in: ['entering', 'starting_hand', 'in_hand', 'between_hands']
        }
      }
    }),
    room.count({ where: { deletedAt: null } }),
    match.count({
      where: { endedAt: { gte: todayStart } }
    }),
    engineFatalIncident.count({
      where: { createdAt: { gte: todayStart } }
    }),
    ...perDayCountPromises
  ])

  const dailySeries = dayRanges.map((r, i) => ({
    day: r.day,
    matchesEnded: Number(perDayCounts[i * 2] ?? 0),
    engineFatals: Number(perDayCounts[i * 2 + 1] ?? 0)
  }))

  return {
    rangeStart: formatTime(since),
    matchesEndedLast7d,
    matchesEndedTotal,
    engineFatalsLast7d,
    roomsInPlay,
    roomsTotal,
    matchesEndedToday,
    engineFatalsToday,
    dailySeries
  }
}
