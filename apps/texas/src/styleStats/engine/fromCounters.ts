import type { StyleAxes, StyleCounters } from './types'

const rate = (num: number, den: number): number | null => {
  if (den <= 0) return null
  return (num / den) * 100
}

/** 从可加计数派生七轴百分比（0–100） */
export const axesFromCounters = (c: StyleCounters): StyleAxes => ({
  axisVpip: rate(c.vpipHands, c.hands),
  axisPfr: rate(c.pfrHands, c.hands),
  axis3Bet: rate(c.threeBetHands, c.threeBetOpps),
  axisAfq: rate(c.afqAggressive, c.afqActions),
  axisCbet: rate(c.cbetHands, c.cbetOpps),
  axisWtsd: rate(c.wtsdHands, c.sawFlopHands),
  axisWsd: rate(c.wsdWonHands, c.wtsdHands)
})

/** 全站机会加权均值（与 axes 同口径） */
export const populationAveragesFromCounters = (c: StyleCounters) => ({
  avgVpip: rate(c.vpipHands, c.hands),
  avgPfr: rate(c.pfrHands, c.hands),
  avg3Bet: rate(c.threeBetHands, c.threeBetOpps),
  avgAfq: rate(c.afqAggressive, c.afqActions),
  avgCbet: rate(c.cbetHands, c.cbetOpps),
  avgWtsd: rate(c.wtsdHands, c.sawFlopHands),
  avgWsd: rate(c.wsdWonHands, c.wtsdHands)
})

export const addCounters = (
  a: StyleCounters,
  b: StyleCounters
): StyleCounters => ({
  hands: a.hands + b.hands,
  vpipHands: a.vpipHands + b.vpipHands,
  pfrHands: a.pfrHands + b.pfrHands,
  threeBetOpps: a.threeBetOpps + b.threeBetOpps,
  threeBetHands: a.threeBetHands + b.threeBetHands,
  afqAggressive: a.afqAggressive + b.afqAggressive,
  afqActions: a.afqActions + b.afqActions,
  cbetOpps: a.cbetOpps + b.cbetOpps,
  cbetHands: a.cbetHands + b.cbetHands,
  sawFlopHands: a.sawFlopHands + b.sawFlopHands,
  wtsdHands: a.wtsdHands + b.wtsdHands,
  wsdWonHands: a.wsdWonHands + b.wsdWonHands,
  realizedWagerBb: a.realizedWagerBb + b.realizedWagerBb,
  allInAdjWagerBb: a.allInAdjWagerBb + b.allInAdjWagerBb,
  allInEquitySum: a.allInEquitySum + b.allInEquitySum,
  allInEquityCount: a.allInEquityCount + b.allInEquityCount,
  limpHands: a.limpHands + b.limpHands,
  redlineBb: a.redlineBb + b.redlineBb,
  bluelineBb: a.bluelineBb + b.bluelineBb
})
