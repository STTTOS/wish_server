import dayjs from 'dayjs'

import router from '../instance'
import response from '../../utils/response'
import { apiPrefixClient } from '../../config'
import formatTime from '../../utils/formatTime'
import combinePath from '../../utils/combinePath'
import { match, playerMatchRecord } from '../../models'
import { HTTP_STATUS } from '../../constants/httpStatus'

const userClientApi = combinePath(apiPrefixClient)('/user')

/** 最近同玩：只统计近 N 天内共同参与过的对局 */
const RECENT_COPLAY_LOOKBACK_DAYS = 15
/** 列表上限，避免极端账号一次返回过大 */
const RECENT_COPLAY_LIST_LIMIT = 100

export type RecentCoplayerItem = {
  userId: number
  name: string
  avatarKey: string
  avatarUrl: string | null
  /** 近 N 天共同参与的对局手数 */
  playCount: number
  lastPlayedAt: string
}

function matchSortTime(m: {
  endedAt: Date | null
  startedAt: Date | null
  createdAt: Date
}): Date {
  return m.endedAt ?? m.startedAt ?? m.createdAt
}

/**
 * C 端：近 15 天同桌过的玩家（不含自己），按最近同玩时间倒序。
 * 行字段：头像/昵称、最近同玩时间、同玩次数。
 */
router.post(userClientApi('/recent-coplayers'), async (ctx) => {
  const userId = ctx.state.user?.id
  if (!userId) {
    response.error(ctx, HTTP_STATUS.UNAUTHORIZED, '身份凭证无效, 请重新登录')
    return
  }

  const since = dayjs().subtract(RECENT_COPLAY_LOOKBACK_DAYS, 'day').toDate()

  const myMatches = await match.findMany({
    where: {
      playerMatchRecords: { some: { userId } },
      OR: [
        { endedAt: { gte: since } },
        { startedAt: { gte: since } },
        { createdAt: { gte: since } }
      ]
    },
    select: {
      id: true,
      endedAt: true,
      startedAt: true,
      createdAt: true
    }
  })

  if (myMatches.length === 0) {
    response.success(ctx, {
      list: [] as RecentCoplayerItem[],
      lookbackDays: RECENT_COPLAY_LOOKBACK_DAYS
    })
    return
  }

  const matchTimeById = new Map<number, number>()
  for (const m of myMatches) {
    matchTimeById.set(m.id, matchSortTime(m).getTime())
  }
  const matchIds = myMatches.map((m) => m.id)

  const coRecords = await playerMatchRecord.findMany({
    where: {
      matchId: { in: matchIds },
      userId: { not: userId },
      user: { deletedAt: null }
    },
    select: {
      userId: true,
      matchId: true,
      user: {
        select: {
          id: true,
          name: true,
          avatarKey: true,
          avatarUrl: true
        }
      }
    }
  })

  type Acc = {
    userId: number
    name: string
    avatarKey: string
    avatarUrl: string | null
    matchIds: Set<number>
    lastTs: number
  }
  const byUser = new Map<number, Acc>()

  for (const row of coRecords) {
    const ts = matchTimeById.get(row.matchId) ?? 0
    const existing = byUser.get(row.userId)
    if (!existing) {
      byUser.set(row.userId, {
        userId: row.user.id,
        name: row.user.name,
        avatarKey: row.user.avatarKey,
        avatarUrl: row.user.avatarUrl,
        matchIds: new Set([row.matchId]),
        lastTs: ts
      })
      continue
    }
    existing.matchIds.add(row.matchId)
    if (ts > existing.lastTs) existing.lastTs = ts
  }

  const list: RecentCoplayerItem[] = [...byUser.values()]
    .map((a) => ({
      userId: a.userId,
      name: a.name,
      avatarKey: a.avatarKey,
      avatarUrl: a.avatarUrl,
      playCount: a.matchIds.size,
      lastPlayedAt: formatTime(new Date(a.lastTs)) || '',
      _sort: a.lastTs
    }))
    .filter((row) => row.lastPlayedAt.length > 0)
    .sort((a, b) => b._sort - a._sort)
    .slice(0, RECENT_COPLAY_LIST_LIMIT)
    .map(
      ({
        userId: id,
        name,
        avatarKey,
        avatarUrl,
        playCount,
        lastPlayedAt
      }) => ({
        userId: id,
        name,
        avatarKey,
        avatarUrl,
        playCount,
        lastPlayedAt
      })
    )

  response.success(ctx, {
    list,
    lookbackDays: RECENT_COPLAY_LOOKBACK_DAYS
  })
})
