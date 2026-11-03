import { logger } from '../logger'
import { STYLE_SCOPE_ALL } from '../styleStats/engine'
import prisma, { playerStyleStat, playerDisciplineStat } from '../models'
import {
  type DecisionStreet,
  type DecisionLineTag,
  type NodeScoreResult,
  type DecisionSnapshot,
  habitScoreFromSignals,
  combineDisciplineScore,
  evaluateDisciplineNode,
  aggregateHandDiscipline,
  type DecisionActionType,
  type HeroPositionBucket,
  PLAYER_DISCIPLINE_VERSION
} from './engine'

const rowToSnapshot = (row: {
  matchId: number
  userId: number
  actionIndex: number
  schemaVersion: number
  street: string
  playersInHand: number
  heroPosition: string
  potBb: number
  toCallBb: number
  lineTag: string
  actionType: string
  actionSizeBb: number
  actionSizePotFrac: number | null
  isForced: boolean
  potOdds: number | null
}): DecisionSnapshot => ({
  matchId: row.matchId,
  userId: row.userId,
  actionIndex: row.actionIndex,
  schemaVersion: row.schemaVersion,
  street: row.street as DecisionStreet,
  playersInHand: row.playersInHand,
  heroPosition: row.heroPosition as HeroPositionBucket,
  potBb: row.potBb,
  toCallBb: row.toCallBb,
  lineTag: row.lineTag as DecisionLineTag,
  actionType: row.actionType as DecisionActionType,
  actionSizeBb: row.actionSizeBb,
  actionSizePotFrac: row.actionSizePotFrac,
  isForced: row.isForced,
  potOdds: row.potOdds
})

/**
 * 对已投影快照评纪律分，并增量更新 PlayerDisciplineStat。
 * 应在 projectDisciplineForHand 成功之后调用。
 */
export const scoreDisciplineForHandSafe = async (matchId: number) => {
  try {
    await scoreDisciplineForHand(matchId)
  } catch (err) {
    logger.error(`[discipline] score failed matchId=${matchId}`, err)
  }
}

export const scoreDisciplineForHand = async (matchId: number) => {
  const snaps = await prisma.disciplineActionSnapshot.findMany({
    where: { matchId, scoredAt: null },
    orderBy: { actionIndex: 'asc' }
  })
  if (!snaps.length) return

  const now = new Date()
  const scoresByUser = new Map<number, NodeScoreResult[]>()

  for (const row of snaps) {
    const snapshot = rowToSnapshot(row)
    const evaluation = evaluateDisciplineNode(snapshot)
    const scored = evaluation.node
    await prisma.disciplineActionSnapshot.update({
      where: { id: row.id },
      data: {
        rulesVersion: evaluation.rulesVersion,
        tier: scored.tier,
        nodeScore: scored.score,
        nodeWeight: scored.weight,
        scoreReason: scored.reason.slice(0, 160),
        dimension: scored.dimension,
        scoredAt: now
      }
    })
    const arr = scoresByUser.get(row.userId) ?? []
    arr.push(scored)
    scoresByUser.set(row.userId, arr)
  }

  for (const [userId, nodeScores] of scoresByUser) {
    const hand = aggregateHandDiscipline(nodeScores)
    if (hand.handDiscipline == null) continue

    const style = await playerStyleStat.findUnique({
      where: { userId_scope: { userId, scope: STYLE_SCOPE_ALL } }
    })
    const hands = Math.max(style?.hands ?? 0, 1)
    const limpRate = (style?.limpHands ?? 0) / hands
    const vpip = style?.axisVpip ?? 0
    const pfr = style?.axisPfr ?? 0
    const wtsd = style?.axisWtsd ?? 0
    const wsd = style?.axisWsd ?? 50
    const pfrRatio = vpip > 0 ? pfr / vpip : 1
    const habitScore = habitScoreFromSignals({
      limpRate,
      highVpip: vpip >= 55,
      callingStation: wtsd >= 35 && wsd < 45,
      lowPfrRatio: vpip >= 40 && pfrRatio < 0.55
    })

    const existing = await playerDisciplineStat.findUnique({
      where: { userId_scope: { userId, scope: STYLE_SCOPE_ALL } }
    })
    const prevN = existing?.handsScored ?? 0
    const prevAction = existing?.actionScore
    const nextN = prevN + 1
    const nextAction =
      prevAction == null
        ? hand.handDiscipline
        : (prevAction * prevN + hand.handDiscipline) / nextN
    const disciplineScore = combineDisciplineScore(nextAction, { habitScore })

    await playerDisciplineStat.upsert({
      where: { userId_scope: { userId, scope: STYLE_SCOPE_ALL } },
      create: {
        userId,
        scope: STYLE_SCOPE_ALL,
        disciplineVersion: PLAYER_DISCIPLINE_VERSION,
        handsScored: 1,
        nodesScored: hand.scoredNodes,
        actionScore: hand.handDiscipline,
        habitScore,
        disciplineScore,
        lastMatchId: matchId
      },
      update: {
        disciplineVersion: PLAYER_DISCIPLINE_VERSION,
        handsScored: nextN,
        nodesScored: (existing?.nodesScored ?? 0) + hand.scoredNodes,
        actionScore: nextAction,
        habitScore,
        disciplineScore,
        lastMatchId: matchId
      }
    })
  }
}
