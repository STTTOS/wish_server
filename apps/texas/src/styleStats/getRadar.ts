import { user, playerStyleStat, stylePopulationStat } from '../models'
import {
  type StyleTag,
  RADAR_MIN_HANDS,
  STYLE_SCOPE_ALL,
  deriveStyleTags,
  SKILL_SAMPLE_HANDS,
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
    score: number | null
    l1: number | null
    l2: number | null
    l3: number | null
    l4: number | null
    /** 同 scope、手数≥SKILL_SAMPLE_HANDS 且有技术分的玩家池中的名次（同分并列，1=最高） */
    rank: number | null
    /** 排名池人数 */
    rankOf: number | null
  }
}

/** 技术分排名：仅统计达标样本；分数更高者名次更前；同分并列同名次 */
const skillRankAmongEligible = async (
  scope: string,
  score: number | null,
  hands: number
): Promise<{ rank: number | null; rankOf: number | null }> => {
  if (score == null || hands < SKILL_SAMPLE_HANDS) {
    return { rank: null, rankOf: null }
  }
  const [better, rankOf] = await Promise.all([
    playerStyleStat.count({
      where: {
        scope,
        hands: { gte: SKILL_SAMPLE_HANDS },
        skillScore: { gt: score }
      }
    }),
    playerStyleStat.count({
      where: {
        scope,
        hands: { gte: SKILL_SAMPLE_HANDS },
        NOT: { skillScore: null }
      }
    })
  ])
  return { rank: better + 1, rankOf }
}

const sampleStatusForHands = (
  hands: number
): UserStyleRadarDto['sampleStatus'] => {
  if (hands < RADAR_MIN_HANDS) return 'insufficient'
  if (hands < SKILL_SAMPLE_HANDS * 2) return 'reference'
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

  const [player, pop] = await Promise.all([
    playerStyleStat.findUnique({
      where: { userId_scope: { userId, scope } }
    }),
    stylePopulationStat.findUnique({ where: { id: scope } })
  ])

  const hands = player?.hands ?? 0
  const sampleStatus = sampleStatusForHands(hands)
  const skillScore = player?.skillScore ?? null
  const { rank: skillRank, rankOf: skillRankOf } = await skillRankAmongEligible(
    scope,
    skillScore,
    hands
  )
  const tags = deriveStyleTags({
    hands,
    sampleStatus,
    vpip: player?.axisVpip ?? null,
    pfr: player?.axisPfr ?? null,
    wtsd: player?.axisWtsd ?? null,
    wsd: player?.axisWsd ?? null,
    skill: skillScore,
    popAvgSkill: pop?.avgSkill ?? null,
    limpHands: player?.limpHands ?? 0,
    chartOkVpipHands: player?.chartOkVpipHands ?? 0,
    chartKnownVpipHands: player?.chartKnownVpipHands ?? 0
  })

  const axes: StyleRadarAxisDto[] = [
    {
      key: 'skill',
      label: '技术分',
      value: skillScore,
      avg: pop?.avgSkill ?? null
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
    updatedAt: player?.updatedAt?.toISOString() ?? null,
    tags,
    axes,
    skill: {
      score: skillScore,
      l1: player?.skillL1 ?? null,
      l2: player?.skillL2 ?? null,
      l3: player?.skillL3 ?? null,
      l4: player?.skillL4 ?? null,
      rank: skillRank,
      rankOf: skillRankOf
    }
  }
}
