import dayjs from 'dayjs'

import router from '../instance'
import response from '../../utils/response'
import { apiPrefixClient } from '../../config'
import formatTime from '../../utils/formatTime'
import combinePath from '../../utils/combinePath'
import { match, playerMatchRecord } from '../../models'
import { HTTP_STATUS } from '../../constants/httpStatus'
import {
  isHeatedSharedHand,
  computeCoplayIntensity,
  type CoplayIntensityTier
} from './coplayIntensity'

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
  /** 交手强度 0–100；样本不足为 null */
  intensityScore: number | null
  intensityTier: CoplayIntensityTier | null
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
 * 附带交手强度（频次 × 大池对峙 × 新鲜度）。
 */
router.post(userClientApi('/recent-coplayers'), async (ctx) => {
  const userId = ctx.state.user?.id
  if (!userId) {
    response.error(ctx, HTTP_STATUS.UNAUTHORIZED, '身份凭证无效, 请重新登录')
    return
  }

  const since = dayjs().subtract(RECENT_COPLAY_LOOKBACK_DAYS, 'day').toDate()
  const nowTs = Date.now()

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
      createdAt: true,
      totalBetAmount: true,
      lowestBetAmount: true
    }
  })

  if (myMatches.length === 0) {
    response.success(ctx, {
      list: [] as RecentCoplayerItem[],
      lookbackDays: RECENT_COPLAY_LOOKBACK_DAYS
    })
    return
  }

  const matchMetaById = new Map<
    number,
    {
      ts: number
      totalBetAmount: number
      lowestBetAmount: number
    }
  >()
  for (const m of myMatches) {
    matchMetaById.set(m.id, {
      ts: matchSortTime(m).getTime(),
      totalBetAmount: Number(m.totalBetAmount ?? 0),
      lowestBetAmount: m.lowestBetAmount ?? 0
    })
  }
  const matchIds = myMatches.map((m) => m.id)

  const tableRecords = await playerMatchRecord.findMany({
    where: {
      matchId: { in: matchIds },
      user: { deletedAt: null }
    },
    select: {
      userId: true,
      matchId: true,
      totalBetAmount: true,
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

  type HandSide = { totalBetAmount: number }
  const handsByMatch = new Map<
    number,
    {
      my?: HandSide
      peers: Map<number, HandSide & { profile: AccProfile }>
    }
  >()

  type AccProfile = {
    userId: number
    name: string
    avatarKey: string
    avatarUrl: string | null
  }

  for (const row of tableRecords) {
    let bucket = handsByMatch.get(row.matchId)
    if (!bucket) {
      bucket = { peers: new Map() }
      handsByMatch.set(row.matchId, bucket)
    }
    const side: HandSide = { totalBetAmount: row.totalBetAmount ?? 0 }
    if (row.userId === userId) {
      bucket.my = side
      continue
    }
    bucket.peers.set(row.userId, {
      ...side,
      profile: {
        userId: row.user.id,
        name: row.user.name,
        avatarKey: row.user.avatarKey,
        avatarUrl: row.user.avatarUrl
      }
    })
  }

  type Acc = AccProfile & {
    matchIds: Set<number>
    heatedHandCount: number
    lastTs: number
  }
  const byUser = new Map<number, Acc>()

  for (const [matchId, bucket] of handsByMatch) {
    const meta = matchMetaById.get(matchId)
    if (!meta || !bucket.my) continue
    for (const [peerId, peer] of bucket.peers) {
      const heated = isHeatedSharedHand({
        lowestBetAmount: meta.lowestBetAmount,
        matchTotalBetAmount: meta.totalBetAmount,
        myTotalBetAmount: bucket.my.totalBetAmount,
        peerTotalBetAmount: peer.totalBetAmount
      })
      const existing = byUser.get(peerId)
      if (!existing) {
        byUser.set(peerId, {
          ...peer.profile,
          matchIds: new Set([matchId]),
          heatedHandCount: heated ? 1 : 0,
          lastTs: meta.ts
        })
        continue
      }
      existing.matchIds.add(matchId)
      if (heated) existing.heatedHandCount += 1
      if (meta.ts > existing.lastTs) existing.lastTs = meta.ts
    }
  }

  const list: RecentCoplayerItem[] = [...byUser.values()]
    .map((a) => {
      const intensity = computeCoplayIntensity({
        playCount: a.matchIds.size,
        heatedHandCount: a.heatedHandCount,
        lastPlayedTs: a.lastTs,
        nowTs,
        freshLookbackDays: RECENT_COPLAY_LOOKBACK_DAYS
      })
      return {
        userId: a.userId,
        name: a.name,
        avatarKey: a.avatarKey,
        avatarUrl: a.avatarUrl,
        playCount: a.matchIds.size,
        lastPlayedAt: formatTime(new Date(a.lastTs)) || '',
        intensityScore: intensity?.score ?? null,
        intensityTier: intensity?.tier ?? null,
        _sort: a.lastTs
      }
    })
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
        lastPlayedAt,
        intensityScore,
        intensityTier
      }) => ({
        userId: id,
        name,
        avatarKey,
        avatarUrl,
        playCount,
        lastPlayedAt,
        intensityScore,
        intensityTier
      })
    )

  response.success(ctx, {
    list,
    lookbackDays: RECENT_COPLAY_LOOKBACK_DAYS
  })
})
