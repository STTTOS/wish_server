import { playerStyleStat } from '../models'
import { STYLE_SCOPE_ALL, SKILL_SAMPLE_HANDS } from './engine'

export type SkillLeaderDto = {
  rank: number
  userId: number
  name: string
  avatarUrl: string | null
  avatarKey: string
  skillScore: number
  hands: number
}

export type SkillLeadersResult = {
  list: SkillLeaderDto[]
  total: number
}

const eligibleWhere = (scope: string) => ({
  scope,
  hands: { gte: SKILL_SAMPLE_HANDS },
  NOT: { skillScore: null },
  user: { deletedAt: null }
})

/**
 * 技术流排行：同 scope、手数达标且有技术分的玩家，按分数降序取前 N。
 * 仅公开昵称/头像/分数/手数，不含 username。
 */
export const getSkillLeaders = async (
  limit = 3,
  scope: string = STYLE_SCOPE_ALL
): Promise<SkillLeadersResult> => {
  const take = Math.min(Math.max(1, Math.floor(limit) || 3), 100)
  const where = eligibleWhere(scope)

  const [rows, total] = await Promise.all([
    playerStyleStat.findMany({
      where,
      orderBy: [{ skillScore: 'desc' }, { hands: 'desc' }, { userId: 'asc' }],
      take,
      select: {
        userId: true,
        skillScore: true,
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
      skillScore: r.skillScore as number,
      hands: r.hands
    }))
  }
}
