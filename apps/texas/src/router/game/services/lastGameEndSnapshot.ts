import type { Poke, Stage, RankCategory, RankSignature } from 'texas-poker-core'
import type {
  WsGameEndData,
  WsGameEndRunItem
} from '@wishufree/texas-ws-contract'

import { match } from '../../../models'
import { fetchMatchOverviewForRoom } from './matchOverviewAggregation'
import {
  settleRecordVisibleFields,
  sortSettleRecordsByOutcome,
  isNoShowdownSingleWinnerFromParticipants
} from '../../match/matchSettleVisibility'

function parseHandPokesJson(raw: unknown): Poke[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((x): x is Poke => typeof x === 'string') as Poke[]
}

function parseBestPokesJson(raw: unknown): Poke[][] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((row): row is unknown[] => Array.isArray(row))
    .map((row) => row.filter((x): x is Poke => typeof x === 'string') as Poke[])
}

function parseSettlementRunsJson(raw: unknown): WsGameEndRunItem[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined
  const runs: WsGameEndRunItem[] = []
  for (const row of raw) {
    if (row == null || typeof row !== 'object') continue
    const r = row as Record<string, unknown>
    let runIndex: 1 | 2 | null = null
    if (r.runIndex === 1) runIndex = 1
    else if (r.runIndex === 2) runIndex = 2
    if (runIndex == null) continue
    const boardPokes = Array.isArray(r.boardPokes)
      ? (r.boardPokes.filter((x) => typeof x === 'string') as Poke[])
      : []
    const item: WsGameEndRunItem = {
      runIndex,
      boardPokes,
      bestPokes: parseBestPokesJson(r.bestPokes)
    }
    if (typeof r.bestRankCategory === 'string') {
      item.bestRankCategory = r.bestRankCategory as RankCategory
    }
    if (typeof r.bestRankSignature === 'string' && r.bestRankSignature.trim()) {
      item.bestRankSignature = r.bestRankSignature.trim() as RankSignature
    }
    if (typeof r.bestRankStrength === 'number') {
      item.bestRankStrength = r.bestRankStrength
    }
    if (Array.isArray(r.winnerUserIds)) {
      item.winnerUserIds = r.winnerUserIds.filter(
        (id): id is number => typeof id === 'number' && Number.isFinite(id)
      )
    }
    if (Array.isArray(r.seats)) {
      const seats = r.seats
        .map((row) => {
          if (row == null || typeof row !== 'object') return null
          const s = row as Record<string, unknown>
          const userId = Number(s.userId)
          if (!Number.isFinite(userId)) return null
          return {
            userId,
            ...(typeof s.rankCategory === 'string'
              ? { rankCategory: s.rankCategory as RankCategory }
              : {}),
            ...(typeof s.rankSignature === 'string' &&
            String(s.rankSignature).trim()
              ? {
                  rankSignature: String(s.rankSignature).trim() as RankSignature
                }
              : {})
          }
        })
        .filter((x): x is NonNullable<typeof x> => x != null)
      if (seats.length > 0) item.seats = seats
    }
    runs.push(item)
  }
  return runs.length > 0 ? runs : undefined
}

/**
 * 局间 HTTP 快照：按 viewer 掩码重建与 WS `game-end` 同形的 `lastGameEnd`。
 * 数据源为已落库的 `Match` + `PlayerMatchRecord`（含自愿亮牌后的 `voluntaryShowHandAt`）。
 */
export async function buildLastGameEndForViewer(input: {
  roomId: number
  matchId: number
  viewerUserId: number
}): Promise<WsGameEndData | null> {
  const { roomId, matchId, viewerUserId } = input

  const matchRow = await match.findFirst({
    where: { id: matchId, roomId, endedAt: { not: null } },
    include: {
      playerMatchRecords: {
        include: {
          user: {
            select: {
              id: true,
              name: true,
              avatarUrl: true,
              avatarKey: true,
              pokerBackgroundKey: true
            }
          }
        }
      }
    }
  })
  if (!matchRow) return null

  const unfoldedOnSetCount = matchRow.playerMatchRecords.filter(
    (row) => !row.isFold
  ).length
  const isNoShowdownSingleWinner = isNoShowdownSingleWinnerFromParticipants(
    matchRow.playerMatchRecords
  )

  let matchOverview: WsGameEndData['matchOverview'] = {
    wagerList: [],
    billList: [],
    playerProfiles: []
  }
  try {
    matchOverview = await fetchMatchOverviewForRoom(roomId)
  } catch {
    // overview 非环桌 inline 结算硬依赖；失败时仍返回 settleList
  }

  const startedAt = matchRow.startedAt?.getTime()
  const endedAt = matchRow.endedAt?.getTime()
  const gameDuration =
    startedAt != null && endedAt != null
      ? Math.max(0, Math.floor((endedAt - startedAt) / 1000))
      : 0

  const settleList = sortSettleRecordsByOutcome(
    matchRow.playerMatchRecords
  ).map((record) => {
    const isSelf = record.userId === viewerUserId
    const voluntarilyShown = record.voluntaryShowHandAt != null
    const hideHoleCardsFromViewer =
      !isSelf &&
      !voluntarilyShown &&
      (record.isFold || isNoShowdownSingleWinner)
    const visible = settleRecordVisibleFields({
      isSelf,
      isFold: record.isFold,
      hideHoleCardsFromViewer,
      handPokes: parseHandPokesJson(record.handPokes),
      rankCategory: record.rankCategory,
      rankStrength: record.rankStrength,
      rankSignature: record.rankSignature
    })
    const balanceAfter = Number(record.balanceAfterHand ?? 0)
    return {
      userId: record.userId,
      name: record.user.name,
      avatarUrl: record.user.avatarUrl,
      avatarKey: record.user.avatarKey,
      pokerBackgroundKey: record.user.pokerBackgroundKey,
      balance: balanceAfter,
      wager: record.wager,
      sevenTwoBonusPaid: record.sevenTwoBonusPaid,
      sevenTwoBonusReceived: record.sevenTwoBonusReceived,
      isAllIn: record.isAllIn,
      isFold: record.isFold,
      canVoluntaryShowHand:
        (record.isFold || unfoldedOnSetCount === 1) &&
        record.voluntaryShowHandAt == null &&
        Number(record.sevenTwoBonusReceived ?? 0) <= 0,
      handPokes: visible.handPokes,
      rankCategory: visible.rankCategory as RankCategory | undefined,
      rankStrength: visible.rankStrength,
      rankSignature: visible.rankSignature as RankSignature | undefined
    }
  })

  const runCount = (matchRow.runCount === 2 ? 2 : 1) as 1 | 2
  const dualRunout = runCount === 2
  const runs = dualRunout
    ? parseSettlementRunsJson(matchRow.settlementRuns)
    : undefined
  // 空串勿下发：客户端牌力条解析会 throw（尤其重连 lastGameEnd）
  const singleRunBestSignature = (() => {
    if (dualRunout) return undefined
    const raw = matchRow.bestRankSignature
    if (raw == null) return undefined
    const trimmed = String(raw).trim()
    return trimmed ? (trimmed as RankSignature) : undefined
  })()

  return {
    matchId,
    settleList,
    matchOverview,
    boardThroughStage: (matchRow.boardThroughStage ?? 'pre_flop') as Stage,
    ...(!dualRunout && matchRow.bestRankCategory != null
      ? { bestRankCategory: matchRow.bestRankCategory }
      : {}),
    ...(singleRunBestSignature != null
      ? { bestRankSignature: singleRunBestSignature }
      : {}),
    gameDuration,
    bestPokes: dualRunout ? [] : parseBestPokesJson(matchRow.bestPokes),
    totalBetAmount: Number(matchRow.totalBetAmount ?? 0),
    runCount,
    ...(runs != null ? { runs } : {})
  }
}
