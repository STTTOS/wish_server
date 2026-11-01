import { logger } from '../logger'
import { STYLE_SCOPE_ALL } from '../styleStats/engine'
import prisma, { playerTechStat, playerStyleStat } from '../models'
import {
  aggregateHandTech,
  combinePlayerTech,
  PLAYER_TECH_VERSION,
  type DecisionStreet,
  evaluateDecisionNode,
  type DecisionLineTag,
  type NodeScoreResult,
  type DecisionSnapshot,
  type DecisionActionType,
  type HeroPositionBucket,
  structureScoreFromSignals
} from './engine'

const rowToSnapshot = (row: {
  matchId: number
  userId: number
  actionIndex: number
  schemaVersion: number
  street: string
  playersInHand: number
  heroPosition: string
  heroStackBb: number
  potBb: number
  toCallBb: number
  spr: number | null
  boardPokes: unknown
  boardTexture: string
  lineTag: string
  aggressorIsHero: boolean
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
  heroStackBb: row.heroStackBb,
  potBb: row.potBb,
  toCallBb: row.toCallBb,
  spr: row.spr,
  boardPokes: Array.isArray(row.boardPokes) ? (row.boardPokes as string[]) : [],
  boardTexture: row.boardTexture as DecisionSnapshot['boardTexture'],
  lineTag: row.lineTag as DecisionLineTag,
  aggressorIsHero: row.aggressorIsHero,
  actionType: row.actionType as DecisionActionType,
  actionSizeBb: row.actionSizeBb,
  actionSizePotFrac: row.actionSizePotFrac,
  isForced: row.isForced,
  potOdds: row.potOdds
})

/**
 * 对已投影快照评分，并增量更新 PlayerTechStat。
 * 应在 projectDecisionSkillForHand 成功之后调用。
 */
export const scoreDecisionSkillForHandSafe = async (matchId: number) => {
  try {
    await scoreDecisionSkillForHand(matchId)
  } catch (err) {
    logger.error(`[decisionSkill] score failed matchId=${matchId}`, err)
  }
}

export const scoreDecisionSkillForHand = async (matchId: number) => {
  const snaps = await prisma.decisionSkillSnapshot.findMany({
    where: { matchId, scoredAt: null },
    orderBy: { actionIndex: 'asc' }
  })
  if (!snaps.length) return

  const now = new Date()
  const scoresByUser = new Map<number, NodeScoreResult[]>()

  for (const row of snaps) {
    const snapshot = rowToSnapshot(row)
    const evaluation = evaluateDecisionNode(snapshot)
    const scored = evaluation.node
    await prisma.decisionSkillSnapshot.update({
      where: { id: row.id },
      data: {
        strategyVersion: evaluation.strategyVersion,
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
    const hand = aggregateHandTech(nodeScores)
    if (hand.handTech == null) continue

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
    const structureScore = structureScoreFromSignals({
      limpRate,
      highVpip: vpip >= 55,
      callingStation: wtsd >= 35 && wsd < 45,
      lowPfrRatio: vpip >= 40 && pfrRatio < 0.55
    })

    const existing = await playerTechStat.findUnique({
      where: { userId_scope: { userId, scope: STYLE_SCOPE_ALL } }
    })
    const prevN = existing?.handsScored ?? 0
    const prevDec = existing?.decisionTech
    const nextN = prevN + 1
    const nextDec =
      prevDec == null
        ? hand.handTech
        : (prevDec * prevN + hand.handTech) / nextN
    const playerTech = combinePlayerTech(nextDec, { structureScore })

    await playerTechStat.upsert({
      where: { userId_scope: { userId, scope: STYLE_SCOPE_ALL } },
      create: {
        userId,
        scope: STYLE_SCOPE_ALL,
        techVersion: PLAYER_TECH_VERSION,
        handsScored: 1,
        nodesScored: hand.scoredNodes,
        decisionTech: hand.handTech,
        structureScore,
        playerTech,
        lastMatchId: matchId
      },
      update: {
        techVersion: PLAYER_TECH_VERSION,
        handsScored: nextN,
        nodesScored: (existing?.nodesScored ?? 0) + hand.scoredNodes,
        decisionTech: nextDec,
        structureScore,
        playerTech,
        lastMatchId: matchId
      }
    })
  }
}
