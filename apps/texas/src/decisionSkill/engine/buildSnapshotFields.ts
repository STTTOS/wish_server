import type {
  DecisionStreet,
  DecisionLineTag,
  DecisionSnapshot,
  DecisionActionType,
  HeroPositionBucket
} from './types'

import { computePotOdds } from './potOdds'
import { classifyBoardTexture } from './boardTexture'
import { DECISION_SNAPSHOT_SCHEMA_VERSION } from './constants'

export type BuildSnapshotInput = {
  matchId: number
  userId: number
  actionIndex: number
  street: DecisionStreet
  playersInHand: number
  heroPosition: HeroPositionBucket
  heroStackBb: number
  potBb: number
  toCallBb: number
  boardPokes?: string[]
  lineTag: DecisionLineTag
  aggressorIsHero: boolean
  actionType: DecisionActionType
  actionSizeBb: number
  isForced: boolean
}

/** 从原始行动字段组装快照（统一派生 potOdds / texture / spr / sizeFrac） */
export const buildDecisionSnapshot = (
  input: BuildSnapshotInput
): DecisionSnapshot => {
  const boardPokes = input.boardPokes ?? []
  const potBb = Math.max(0, input.potBb)
  const toCallBb = Math.max(0, input.toCallBb)
  const actionSizeBb = Math.max(0, input.actionSizeBb)
  const spr =
    potBb > 0 && input.heroStackBb > 0 ? input.heroStackBb / potBb : null
  const betting =
    input.actionType === 'bet' ||
    input.actionType === 'raise' ||
    input.actionType === 'allIn'
  let actionSizePotFrac: number | null = null
  if (betting && potBb > 0) {
    actionSizePotFrac = actionSizeBb / potBb
  }

  return {
    matchId: input.matchId,
    userId: input.userId,
    actionIndex: input.actionIndex,
    schemaVersion: DECISION_SNAPSHOT_SCHEMA_VERSION,
    street: input.street,
    playersInHand: Math.max(1, input.playersInHand),
    heroPosition: input.heroPosition,
    heroStackBb: Math.max(0, input.heroStackBb),
    potBb,
    toCallBb,
    spr,
    boardPokes,
    boardTexture: classifyBoardTexture(boardPokes),
    lineTag: input.lineTag,
    aggressorIsHero: input.aggressorIsHero,
    actionType: input.actionType,
    actionSizeBb,
    actionSizePotFrac,
    isForced: input.isForced,
    potOdds: computePotOdds(potBb, toCallBb)
  }
}
