import { DISCIPLINE_SAMPLE_HANDS } from '../discipline/engine'
import {
  user,
  playerStyleStat,
  stylePopulationStat,
  playerDisciplineStat
} from '../models'
import {
  type StyleTag,
  RADAR_MIN_HANDS,
  STYLE_SCOPE_ALL,
  deriveStyleTags,
  STYLE_STATS_VERSION,
  derivePlayStyleArchetype
} from './engine'

export type StyleRadarAxisKey =
  | 'vpip'
  | 'pfr'
  | 'threeBet'
  | 'afq'
  | 'cbet'
  | 'wtsd'
  | 'wsd'
  | 'discipline'

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
  /** 打法特征（互斥：紧凶/紧被动/松凶/松被动/常规） */
  playStyle: StyleTag | null
  /** 样本状态 + 漏洞标签（不含打法特征） */
  tags: StyleTag[]
  axes: StyleRadarAxisDto[]
  discipline: {
    /** 行动纪律 + 习惯纪律 */
    score: number | null
    /** 行动纪律（单手节点加权均值的跨手平均） */
    action: number | null
    /** 习惯纪律 */
    habit: number | null
    rank: number | null
    rankOf: number | null
  }
  /** 机会/分母样本，供解读展示可信度 */
  samples: {
    hands: number
    threeBetOpps: number
    cbetOpps: number
    afqActions: number
    limpHands: number
  }
}

const disciplineRankAmongEligible = async (
  scope: string,
  score: number | null,
  handsScored: number
): Promise<{ rank: number | null; rankOf: number | null }> => {
  if (score == null || handsScored < DISCIPLINE_SAMPLE_HANDS) {
    return { rank: null, rankOf: null }
  }
  const [better, rankOf] = await Promise.all([
    playerDisciplineStat.count({
      where: {
        scope,
        handsScored: { gte: DISCIPLINE_SAMPLE_HANDS },
        disciplineScore: { gt: score }
      }
    }),
    playerDisciplineStat.count({
      where: {
        scope,
        handsScored: { gte: DISCIPLINE_SAMPLE_HANDS },
        NOT: { disciplineScore: null }
      }
    })
  ])
  return { rank: better + 1, rankOf }
}

const sampleStatusForHands = (
  hands: number
): UserStyleRadarDto['sampleStatus'] => {
  if (hands < RADAR_MIN_HANDS) return 'insufficient'
  if (hands < DISCIPLINE_SAMPLE_HANDS * 2) return 'reference'
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

  const [player, pop, disc] = await Promise.all([
    playerStyleStat.findUnique({
      where: { userId_scope: { userId, scope } }
    }),
    stylePopulationStat.findUnique({ where: { id: scope } }),
    playerDisciplineStat.findUnique({
      where: { userId_scope: { userId, scope } }
    })
  ])

  const hands = player?.hands ?? 0
  const sampleStatus = sampleStatusForHands(hands)
  const disciplineScore = disc?.disciplineScore ?? null
  const action = disc?.actionScore ?? null
  const habit = disc?.habitScore ?? null
  const { rank: disciplineRank, rankOf: disciplineRankOf } =
    await disciplineRankAmongEligible(
      scope,
      disciplineScore,
      disc?.handsScored ?? 0
    )

  const discAvgRow = await playerDisciplineStat.aggregate({
    where: {
      scope,
      handsScored: { gte: DISCIPLINE_SAMPLE_HANDS },
      NOT: { disciplineScore: null }
    },
    _avg: { disciplineScore: true }
  })
  const avgDiscipline = discAvgRow._avg.disciplineScore ?? null

  const tagInput = {
    hands,
    sampleStatus,
    vpip: player?.axisVpip ?? null,
    pfr: player?.axisPfr ?? null,
    wtsd: player?.axisWtsd ?? null,
    wsd: player?.axisWsd ?? null,
    discipline: disciplineScore,
    popAvgDiscipline: avgDiscipline,
    limpHands: player?.limpHands ?? 0
  }
  const playStyle = derivePlayStyleArchetype(tagInput)
  const tags = deriveStyleTags(tagInput)

  const axes: StyleRadarAxisDto[] = [
    {
      key: 'discipline',
      label: '纪律分',
      value: disciplineScore,
      avg: avgDiscipline
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
      disc?.updatedAt?.toISOString() ??
      player?.updatedAt?.toISOString() ??
      null,
    playStyle,
    tags,
    axes,
    discipline: {
      score: disciplineScore,
      action,
      habit,
      rank: disciplineRank,
      rankOf: disciplineRankOf
    },
    samples: {
      hands,
      threeBetOpps: player?.threeBetOpps ?? 0,
      cbetOpps: player?.cbetOpps ?? 0,
      afqActions: player?.afqActions ?? 0,
      limpHands: player?.limpHands ?? 0
    }
  }
}
