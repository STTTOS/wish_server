import { STYLE_SCOPE_ALL } from './engine'
import { playerStyleStat } from '../models'

/** 积分榜样本门槛（与纪律榜手数口径对齐：有牌风物化手数） */
export const SCORE_SAMPLE_HANDS = 50

export type ScoreLeaderDto = {
  rank: number
  userId: number
  name: string
  avatarUrl: string | null
  avatarKey: string
  /** 终身总输赢（大盲单位，可正可负） */
  totalBb: number
  hands: number
}

export type ScoreLeadersResult = {
  list: ScoreLeaderDto[]
  total: number
}

/**
 * 积分榜：按 PlayerStyleStat.realizedWagerBb（总输赢 BB）降序。
 */
export const getScoreLeaders = async (
  limit = 3,
  scope: string = STYLE_SCOPE_ALL
): Promise<ScoreLeadersResult> => {
  const take = Math.min(Math.max(1, Math.floor(limit) || 3), 100)
  const where = {
    scope,
    hands: { gte: SCORE_SAMPLE_HANDS },
    user: { deletedAt: null }
  }

  const [rows, total] = await Promise.all([
    playerStyleStat.findMany({
      where,
      orderBy: [
        { realizedWagerBb: 'desc' },
        { hands: 'desc' },
        { userId: 'asc' }
      ],
      take,
      select: {
        userId: true,
        realizedWagerBb: true,
        hands: true,
        user: {
          select: {
            name: true,
            avatarUrl: true,
            avatarKey: true
          }
        }
      }
    }),
    playerStyleStat.count({ where })
  ])

  return {
    total,
    list: rows.map((r, i) => ({
      rank: i + 1,
      userId: r.userId,
      name: r.user.name,
      avatarUrl: r.user.avatarUrl,
      avatarKey: r.user.avatarKey,
      totalBb: r.realizedWagerBb,
      hands: r.hands
    }))
  }
}
