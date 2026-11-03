import { STYLE_SCOPE_ALL } from './engine'
import { playerDisciplineStat } from '../models'
import { DISCIPLINE_SAMPLE_HANDS } from '../discipline/engine'

export type DisciplineLeaderDto = {
  rank: number
  userId: number
  name: string
  avatarUrl: string | null
  avatarKey: string
  disciplineScore: number
  hands: number
}

export type DisciplineLeadersResult = {
  list: DisciplineLeaderDto[]
  total: number
}

/**
 * 纪律榜：按纪律分（行动 + 习惯）降序。
 * hands 字段用 handsScored（有效评分手数）。
 */
export const getDisciplineLeaders = async (
  limit = 3,
  scope: string = STYLE_SCOPE_ALL
): Promise<DisciplineLeadersResult> => {
  const take = Math.min(Math.max(1, Math.floor(limit) || 3), 100)
  const where = {
    scope,
    handsScored: { gte: DISCIPLINE_SAMPLE_HANDS },
    NOT: { disciplineScore: null },
    user: { deletedAt: null }
  }

  const [rows, total] = await Promise.all([
    playerDisciplineStat.findMany({
      where,
      orderBy: [
        { disciplineScore: 'desc' },
        { handsScored: 'desc' },
        { userId: 'asc' }
      ],
      take,
      select: {
        userId: true,
        disciplineScore: true,
        handsScored: true,
        user: {
          select: {
            name: true,
            avatarUrl: true,
            avatarKey: true
          }
        }
      }
    }),
    playerDisciplineStat.count({ where })
  ])

  return {
    total,
    list: rows.map((r, i) => ({
      rank: i + 1,
      userId: r.userId,
      name: r.user.name,
      avatarUrl: r.user.avatarUrl,
      avatarKey: r.user.avatarKey,
      disciplineScore: r.disciplineScore as number,
      hands: r.handsScored
    }))
  }
}
