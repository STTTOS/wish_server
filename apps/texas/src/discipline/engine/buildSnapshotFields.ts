import type {
  DecisionStreet,
  DecisionLineTag,
  DecisionSnapshot,
  DecisionActionType,
  HeroPositionBucket
} from './types'

import { computePotOdds } from './potOdds'
import { DISCIPLINE_SNAPSHOT_SCHEMA_VERSION } from './constants'

export type BuildSnapshotInput = {
  matchId: number
  userId: number
  actionIndex: number
  street: DecisionStreet
  playersInHand: number
  heroPosition: HeroPositionBucket
  potBb: number
  toCallBb: number
  lineTag: DecisionLineTag
  actionType: DecisionActionType
  actionSizeBb: number
  isForced: boolean
}

/** 从原始行动字段组装快照（统一派生 potOdds / sizeFrac） */
export const buildDecisionSnapshot = (
  input: BuildSnapshotInput
): DecisionSnapshot => {
  const potBb = Math.max(0, input.potBb)
  const toCallBb = Math.max(0, input.toCallBb)
  const actionSizeBb = Math.max(0, input.actionSizeBb)
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
    schemaVersion: DISCIPLINE_SNAPSHOT_SCHEMA_VERSION,
    street: input.street,
    playersInHand: Math.max(1, input.playersInHand),
    heroPosition: input.heroPosition,
    potBb,
    toCallBb,
    lineTag: input.lineTag,
    actionType: input.actionType,
    actionSizeBb,
    actionSizePotFrac,
    isForced: input.isForced,
    potOdds: computePotOdds(potBb, toCallBb)
  }
}
