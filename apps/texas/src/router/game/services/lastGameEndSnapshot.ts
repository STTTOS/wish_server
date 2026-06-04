import type { WsGameEndData } from '@wishufree/texas-ws-contract'
import type { Poke, Stage, RankCategory, RankSignature } from 'texas-poker-core'

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

  return {
    matchId,
    settleList,
    matchOverview,
    boardThroughStage: (matchRow.boardThroughStage ?? 'pre_flop') as Stage,
    bestRankCategory: matchRow.bestRankCategory ?? undefined,
    bestRankSignature:
      (matchRow.bestRankSignature as RankSignature | null) ?? undefined,
    gameDuration,
    bestPokes: parseBestPokesJson(matchRow.bestPokes),
    totalBetAmount: Number(matchRow.totalBetAmount ?? 0)
  }
}
