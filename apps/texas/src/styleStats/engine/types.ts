import type { Role, Stage, ActionType } from '@prisma/texas-client'

/** 一手可加计数增量（与 PlayerStyleStat 计数列对齐） */
export type HandStyleDelta = {
  hands: number
  vpipHands: number
  pfrHands: number
  threeBetOpps: number
  threeBetHands: number
  afqAggressive: number
  afqActions: number
  cbetOpps: number
  cbetHands: number
  sawFlopHands: number
  wtsdHands: number
  wsdWonHands: number
  realizedWagerBb: number
  allInAdjWagerBb: number
  allInEquitySum: number
  allInEquityCount: number
  chartOkVpipHands: number
  limpHands: number
  redlineBb: number
  bluelineBb: number
}

export type StyleCounters = HandStyleDelta

export type StyleAxes = {
  axisVpip: number | null
  axisPfr: number | null
  axis3Bet: number | null
  axisAfq: number | null
  axisCbet: number | null
  axisWtsd: number | null
  axisWsd: number | null
}

export type SkillBreakdown = {
  skillL1: number
  skillL2: number
  skillL3: number
  skillL4: number
  skillScore: number
}

export type StyleAction = {
  userId: number
  actionType: ActionType
  amount: number
  stage: Stage
}

export type StyleSeat = {
  userId: number
  role: Role | null
  handPokes: string[]
  wager: number
  isFold: boolean
  isAllIn: boolean
  /** 是否进入摊牌比牌（非弃牌独赢） */
  wentToShowdown: boolean
}

export type StyleHandInput = {
  matchId: number
  lowestBetAmount: number
  /** 已发公牌（结算时完整或截止街道） */
  boardPokes: string[]
  /** 行动结束街道 / 公牌街道，用于判断是否见过 flop */
  boardThroughStage: Stage | null
  actions: StyleAction[]
  seats: StyleSeat[]
}

export const emptyHandStyleDelta = (): HandStyleDelta => ({
  hands: 0,
  vpipHands: 0,
  pfrHands: 0,
  threeBetOpps: 0,
  threeBetHands: 0,
  afqAggressive: 0,
  afqActions: 0,
  cbetOpps: 0,
  cbetHands: 0,
  sawFlopHands: 0,
  wtsdHands: 0,
  wsdWonHands: 0,
  realizedWagerBb: 0,
  allInAdjWagerBb: 0,
  allInEquitySum: 0,
  allInEquityCount: 0,
  chartOkVpipHands: 0,
  limpHands: 0,
  redlineBb: 0,
  bluelineBb: 0
})
