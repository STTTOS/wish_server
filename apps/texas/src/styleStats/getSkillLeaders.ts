import { playerTechStat } from '../models'
import { STYLE_SCOPE_ALL } from './engine'
import { TECH_SAMPLE_HANDS } from '../decisionSkill/engine'

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

/**
 * 技术流排行：按 PlayerTech（决策+结构）降序。
 * hands 字段用 handsScored（有效评分手数）。
 */
export const getSkillLeaders = async (
  limit = 3,
  scope: string = STYLE_SCOPE_ALL
): Promise<SkillLeadersResult> => {
  const take = Math.min(Math.max(1, Math.floor(limit) || 3), 100)
  const where = {
    scope,
    handsScored: { gte: TECH_SAMPLE_HANDS },
    NOT: { playerTech: null },
    user: { deletedAt: null }
  }

  const [rows, total] = await Promise.all([
    playerTechStat.findMany({
      where,
      orderBy: [
        { playerTech: 'desc' },
        { handsScored: 'desc' },
        { userId: 'asc' }
      ],
      take,
      select: {
        userId: true,
        playerTech: true,
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
    playerTechStat.count({ where })
  ])

  return {
    total,
    list: rows.map((r, i) => ({
      rank: i + 1,
      userId: r.userId,
      name: r.user.name,
      avatarUrl: r.user.avatarUrl,
      avatarKey: r.user.avatarKey,
      skillScore: r.playerTech as number,
      hands: r.handsScored
    }))
  }
}
