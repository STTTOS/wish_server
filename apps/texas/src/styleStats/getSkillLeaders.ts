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

/**
 * 技术流排行：同 scope、手数达标且有技术分的玩家，按分数降序取前 N。
 * 仅公开昵称/头像/分数/手数，不含 username。
 */
export const getSkillLeaders = async (
  limit = 3,
  scope: string = STYLE_SCOPE_ALL
): Promise<SkillLeaderDto[]> => {
  const take = Math.min(Math.max(1, Math.floor(limit) || 3), 10)
  const rows = await playerStyleStat.findMany({
    where: {
      scope,
      hands: { gte: SKILL_SAMPLE_HANDS },
      NOT: { skillScore: null },
      user: { deletedAt: null }
    },
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
  })

  return rows.map((r, i) => ({
    rank: i + 1,
    userId: r.userId,
    name: r.user.name,
    avatarUrl: r.user.avatarUrl,
    avatarKey: r.user.avatarKey,
    skillScore: r.skillScore as number,
    hands: r.hands
  }))
}
