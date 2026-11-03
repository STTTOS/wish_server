import type { Prisma } from '@prisma/texas-client'

import dayjs from 'dayjs'

import { playerMatchRecord } from '../../models'

/** 客户端历史战绩牌型筛选：全部 / 未成牌（翻前结束）/ RankCategory */
export const MATCH_LIST_RANK_FILTERS = [
  'all',
  'unmade',
  'z',
  'y',
  'x',
  'w',
  'v',
  'u',
  't',
  's',
  'r',
  'q'
] as const
export type MatchListRankFilter = (typeof MATCH_LIST_RANK_FILTERS)[number]

export const MATCH_LIST_TIME_PRESETS = [
  'all',
  'last3d',
  'last7d',
  'range'
] as const
export type MatchListTimePreset = (typeof MATCH_LIST_TIME_PRESETS)[number]

export const MATCH_LIST_RESULT_FILTERS = ['all', 'win', 'lose'] as const
export type MatchListResultFilter = (typeof MATCH_LIST_RESULT_FILTERS)[number]

export const MATCH_LIST_STAGES = ['pre_flop', 'flop', 'turn', 'river'] as const
export type MatchListStage = (typeof MATCH_LIST_STAGES)[number]

export function parseMatchListRankFilter(
  raw: unknown
): MatchListRankFilter | null {
  if (raw == null || raw === '') return 'all'
  if (
    typeof raw === 'string' &&
    (MATCH_LIST_RANK_FILTERS as readonly string[]).includes(raw)
  ) {
    return raw as MatchListRankFilter
  }
  return null
}

export function parseMatchListTimePreset(
  raw: unknown
): MatchListTimePreset | null {
  if (raw == null || raw === '') return 'all'
  if (
    typeof raw === 'string' &&
    (MATCH_LIST_TIME_PRESETS as readonly string[]).includes(raw)
  ) {
    return raw as MatchListTimePreset
  }
  return null
}

export function parseMatchListResultFilter(
  raw: unknown
): MatchListResultFilter | null {
  if (raw == null || raw === '') return 'all'
  if (
    typeof raw === 'string' &&
    (MATCH_LIST_RESULT_FILTERS as readonly string[]).includes(raw)
  ) {
    return raw as MatchListResultFilter
  }
  return null
}

export function parseMatchListStageFilter(
  raw: unknown
): MatchListStage | 'all' | null {
  if (raw == null || raw === '' || raw === 'all') return 'all'
  if (
    typeof raw === 'string' &&
    (MATCH_LIST_STAGES as readonly string[]).includes(raw)
  ) {
    return raw as MatchListStage
  }
  return null
}

export function parseMatchListMemberCount(raw: unknown): number | 'all' | null {
  if (raw == null || raw === '' || raw === 'all') return 'all'
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 2 || n > 10) return null
  return n
}

/** 解析自定义时间段边界；无效返回 null */
export function parseMatchListRangeBound(
  raw: unknown,
  bound: 'start' | 'end'
): dayjs.Dayjs | null {
  if (raw == null || raw === '') return null
  if (typeof raw !== 'string') return null
  const d = dayjs(raw)
  if (!d.isValid()) return null
  return bound === 'start' ? d.startOf('day') : d.endOf('day')
}

export function resolveStartedAtFilter(
  timePreset: MatchListTimePreset,
  startedAtFrom: unknown,
  startedAtTo: unknown
):
  | { ok: true; filter?: Prisma.DateTimeNullableFilter }
  | { ok: false; message: string } {
  if (timePreset === 'last3d') {
    return { ok: true, filter: { gte: dayjs().subtract(3, 'day').toDate() } }
  }
  if (timePreset === 'last7d') {
    return { ok: true, filter: { gte: dayjs().subtract(7, 'day').toDate() } }
  }
  if (timePreset !== 'range') {
    return { ok: true }
  }
  const from = parseMatchListRangeBound(startedAtFrom, 'start')
  const to = parseMatchListRangeBound(startedAtTo, 'end')
  if (from == null || to == null) {
    return { ok: false, message: '自定义时间段参数异常' }
  }
  if (from.isAfter(to)) {
    return { ok: false, message: '自定义时间段起止颠倒' }
  }
  return { ok: true, filter: { gte: from.toDate(), lte: to.toDate() } }
}

/** 未成牌与结束轮次：未成牌强制 pre_flop；冲突时返回 null 表示空结果 */
export function resolveBoardStageFilter(
  rankFilter: MatchListRankFilter,
  endStage: MatchListStage | 'all'
): MatchListStage | 'all' | null {
  if (rankFilter === 'unmade') {
    if (endStage !== 'all' && endStage !== 'pre_flop') return null
    return 'pre_flop'
  }
  return endStage
}

export async function loadMatchIdsWithExactPlayerCount(params: {
  targetUserId: number
  memberCount: number
  matchWhere: Prisma.MatchWhereInput
}): Promise<number[]> {
  const rows = await playerMatchRecord.groupBy({
    by: ['matchId'],
    where: {
      match: {
        is: {
          ...params.matchWhere,
          playerMatchRecords: {
            some: { userId: params.targetUserId }
          }
        }
      }
    },
    having: {
      matchId: {
        _count: { equals: params.memberCount }
      }
    },
    _count: { matchId: true }
  })
  return rows.map((row) => row.matchId)
}
