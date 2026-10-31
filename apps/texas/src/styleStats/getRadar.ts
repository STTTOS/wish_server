import { TECH_SAMPLE_HANDS } from '../decisionSkill/engine'
import {
  user,
  playerTechStat,
  playerStyleStat,
  stylePopulationStat
} from '../models'
import {
  type StyleTag,
  RADAR_MIN_HANDS,
  STYLE_SCOPE_ALL,
  deriveStyleTags,
  STYLE_STATS_VERSION
} from './engine'

export type StyleRadarAxisKey =
  | 'vpip'
  | 'pfr'
  | 'threeBet'
  | 'afq'
  | 'cbet'
  | 'wtsd'
  | 'wsd'
  | 'skill'

export type StyleRadarAxisDto = {
  key: StyleRadarAxisKey
  label: string
  value: number | null
  avg: number | null
}

export type UserStyleRadarDto = {
  userId: number
  name: string
  username: string
  scope: string
  hands: number
  sampleStatus: 'insufficient' | 'reference' | 'ok'
  statsVersion: number
  updatedAt: string | null
  tags: StyleTag[]
  axes: StyleRadarAxisDto[]
  skill: {
    /** PlayerTech：决策 + 结构 */
    score: number | null
    /** 决策聚合 HandTech 均值 */
    decision: number | null
    /** 结构健康分 */
    structure: number | null
    rank: number | null
    rankOf: number | null
  }
}

const techRankAmongEligible = async (
  scope: string,
  score: number | null,
  handsScored: number
): Promise<{ rank: number | null; rankOf: number | null }> => {
  if (score == null || handsScored < TECH_SAMPLE_HANDS) {
    return { rank: null, rankOf: null }
  }
  const [better, rankOf] = await Promise.all([
    playerTechStat.count({
      where: {
        scope,
        handsScored: { gte: TECH_SAMPLE_HANDS },
        playerTech: { gt: score }
      }
    }),
    playerTechStat.count({
      where: {
        scope,
        handsScored: { gte: TECH_SAMPLE_HANDS },
        NOT: { playerTech: null }
      }
    })
  ])
  return { rank: better + 1, rankOf }
}

const sampleStatusForHands = (
  hands: number
): UserStyleRadarDto['sampleStatus'] => {
  if (hands < RADAR_MIN_HANDS) return 'insufficient'
  if (hands < TECH_SAMPLE_HANDS * 2) return 'reference'
  return 'ok'
}

/** 只读物化表，组装管理端雷达 DTO */
export const getUserStyleRadar = async (
  userId: number,
  scope: string = STYLE_SCOPE_ALL
): Promise<UserStyleRadarDto | null> => {
  const profile = await user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, username: true, deletedAt: true }
  })
  if (!profile) return null

  const [player, pop, tech] = await Promise.all([
    playerStyleStat.findUnique({
      where: { userId_scope: { userId, scope } }
    }),
    stylePopulationStat.findUnique({ where: { id: scope } }),
    playerTechStat.findUnique({
      where: { userId_scope: { userId, scope } }
    })
  ])

  const hands = player?.hands ?? 0
  const sampleStatus = sampleStatusForHands(hands)
  const playerTech = tech?.playerTech ?? null
  const decision = tech?.decisionTech ?? null
  const structure = tech?.structureScore ?? null
  const { rank: skillRank, rankOf: skillRankOf } = await techRankAmongEligible(
    scope,
    playerTech,
    tech?.handsScored ?? 0
  )

  // 全站技术均分：有 tech 的达标用户简单平均（机会加权后续可加）
  const techAvgRow = await playerTechStat.aggregate({
    where: {
      scope,
      handsScored: { gte: TECH_SAMPLE_HANDS },
      NOT: { playerTech: null }
    },
    _avg: { playerTech: true }
  })
  const avgTech = techAvgRow._avg.playerTech ?? null

  const tags = deriveStyleTags({
    hands,
    sampleStatus,
    vpip: player?.axisVpip ?? null,
    pfr: player?.axisPfr ?? null,
    wtsd: player?.axisWtsd ?? null,
    wsd: player?.axisWsd ?? null,
    skill: playerTech,
    popAvgSkill: avgTech,
    limpHands: player?.limpHands ?? 0
  })

  const axes: StyleRadarAxisDto[] = [
    {
      key: 'skill',
      label: '技术分',
      value: playerTech,
      avg: avgTech
    },
    {
      key: 'vpip',
      label: 'VPIP',
      value: player?.axisVpip ?? null,
      avg: pop?.avgVpip ?? null
    },
    {
      key: 'pfr',
      label: 'PFR',
      value: player?.axisPfr ?? null,
      avg: pop?.avgPfr ?? null
    },
    {
      key: 'threeBet',
      label: '3Bet',
      value: player?.axis3Bet ?? null,
      avg: pop?.avg3Bet ?? null
    },
    {
      key: 'afq',
      label: 'AFq',
      value: player?.axisAfq ?? null,
      avg: pop?.avgAfq ?? null
    },
    {
      key: 'cbet',
      label: 'CBet',
      value: player?.axisCbet ?? null,
      avg: pop?.avgCbet ?? null
    },
    {
      key: 'wtsd',
      label: 'WTSD',
      value: player?.axisWtsd ?? null,
      avg: pop?.avgWtsd ?? null
    },
    {
      key: 'wsd',
      label: 'W$SD',
      value: player?.axisWsd ?? null,
      avg: pop?.avgWsd ?? null
    }
  ]

  return {
    userId: profile.id,
    name: profile.name,
    username: profile.username,
    scope,
    hands,
    sampleStatus,
    statsVersion: player?.statsVersion ?? STYLE_STATS_VERSION,
    updatedAt:
      tech?.updatedAt?.toISOString() ??
      player?.updatedAt?.toISOString() ??
      null,
    tags,
    axes,
    skill: {
      score: playerTech,
      decision,
      structure,
      rank: skillRank,
      rankOf: skillRankOf
    }
  }
}
