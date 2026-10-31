import type { Prisma } from '@prisma/texas-client'

import {
  STYLE_SCOPE_ALL,
  axesFromCounters,
  type StyleCounters,
  STYLE_STATS_VERSION,
  type HandStyleDelta,
  populationAveragesFromCounters
} from './engine'

type Tx = Prisma.TransactionClient

const counterFieldsFromDelta = (d: HandStyleDelta) => ({
  hands: d.hands,
  vpipHands: d.vpipHands,
  pfrHands: d.pfrHands,
  threeBetOpps: d.threeBetOpps,
  threeBetHands: d.threeBetHands,
  afqAggressive: d.afqAggressive,
  afqActions: d.afqActions,
  cbetOpps: d.cbetOpps,
  cbetHands: d.cbetHands,
  sawFlopHands: d.sawFlopHands,
  wtsdHands: d.wtsdHands,
  wsdWonHands: d.wsdWonHands,
  realizedWagerBb: d.realizedWagerBb,
  allInAdjWagerBb: d.allInAdjWagerBb,
  allInEquitySum: d.allInEquitySum,
  allInEquityCount: d.allInEquityCount,
  chartOkVpipHands: d.chartOkVpipHands,
  chartKnownVpipHands: d.chartKnownVpipHands,
  limpHands: d.limpHands,
  redlineBb: d.redlineBb,
  bluelineBb: d.bluelineBb
})

const inc = (n: number) => ({ increment: n })

const toCounters = (row: {
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
  chartKnownVpipHands: number
  limpHands: number
  redlineBb: number
  bluelineBb: number
}): StyleCounters => ({
  hands: row.hands,
  vpipHands: row.vpipHands,
  pfrHands: row.pfrHands,
  threeBetOpps: row.threeBetOpps,
  threeBetHands: row.threeBetHands,
  afqAggressive: row.afqAggressive,
  afqActions: row.afqActions,
  cbetOpps: row.cbetOpps,
  cbetHands: row.cbetHands,
  sawFlopHands: row.sawFlopHands,
  wtsdHands: row.wtsdHands,
  wsdWonHands: row.wsdWonHands,
  realizedWagerBb: row.realizedWagerBb,
  allInAdjWagerBb: row.allInAdjWagerBb,
  allInEquitySum: row.allInEquitySum,
  allInEquityCount: row.allInEquityCount,
  chartOkVpipHands: row.chartOkVpipHands,
  chartKnownVpipHands: row.chartKnownVpipHands,
  limpHands: row.limpHands,
  redlineBb: row.redlineBb,
  bluelineBb: row.bluelineBb
})

/** 轴缓存；旧 L1–L4 技术分已迁至 decisionSkill / PlayerTechStat */
const derivedCache = (c: StyleCounters) => {
  const axes = axesFromCounters(c)
  return {
    axisVpip: axes.axisVpip,
    axisPfr: axes.axisPfr,
    axis3Bet: axes.axis3Bet,
    axisAfq: axes.axisAfq,
    axisCbet: axes.axisCbet,
    axisWtsd: axes.axisWtsd,
    axisWsd: axes.axisWsd,
    skillScore: null as number | null,
    skillL1: null as number | null,
    skillL2: null as number | null,
    skillL3: null as number | null,
    skillL4: null as number | null
  }
}

const populationAvgCache = (c: StyleCounters, avgSkill: number | null) => {
  const a = populationAveragesFromCounters(c)
  return { ...a, avgSkill }
}

/**
 * 将一手 delta 写入用户 scope 行 + 全站 population；刷新缓存轴/技术分。
 */
export const applyHandStyleDeltas = async (
  tx: Tx,
  args: {
    matchId: number
    /** `all` 与可选桌型 scope */
    scopes: string[]
    deltas: Map<number, HandStyleDelta>
  }
) => {
  const { matchId, scopes, deltas } = args
  const uniqueScopes = [...new Set(scopes.filter(Boolean))]
  if (!uniqueScopes.includes(STYLE_SCOPE_ALL)) {
    uniqueScopes.unshift(STYLE_SCOPE_ALL)
  }

  for (const scope of uniqueScopes) {
    await upsertPopulationDelta(tx, {
      scope,
      deltas: [...deltas.values()]
    })
    for (const [userId, delta] of deltas) {
      await upsertPlayerDelta(tx, {
        userId,
        scope,
        matchId,
        delta
      })
    }
  }
}

const upsertPlayerDelta = async (
  tx: Tx,
  args: {
    userId: number
    scope: string
    matchId: number
    delta: HandStyleDelta
  }
) => {
  const { userId, scope, matchId, delta } = args
  const existing = await tx.playerStyleStat.findUnique({
    where: { userId_scope: { userId, scope } }
  })

  const fields = counterFieldsFromDelta(delta)
  const incrementData = Object.fromEntries(
    Object.entries(fields).map(([k, v]) => [k, inc(v)])
  ) as Prisma.PlayerStyleStatUpdateInput

  if (!existing) {
    const counters = { ...fields }
    const cache = derivedCache(counters)
    await tx.playerStyleStat.create({
      data: {
        userId,
        scope,
        statsVersion: STYLE_STATS_VERSION,
        lastMatchId: matchId,
        ...counters,
        ...cache
      }
    })
    return
  }

  const merged = toCounters({
    hands: existing.hands + delta.hands,
    vpipHands: existing.vpipHands + delta.vpipHands,
    pfrHands: existing.pfrHands + delta.pfrHands,
    threeBetOpps: existing.threeBetOpps + delta.threeBetOpps,
    threeBetHands: existing.threeBetHands + delta.threeBetHands,
    afqAggressive: existing.afqAggressive + delta.afqAggressive,
    afqActions: existing.afqActions + delta.afqActions,
    cbetOpps: existing.cbetOpps + delta.cbetOpps,
    cbetHands: existing.cbetHands + delta.cbetHands,
    sawFlopHands: existing.sawFlopHands + delta.sawFlopHands,
    wtsdHands: existing.wtsdHands + delta.wtsdHands,
    wsdWonHands: existing.wsdWonHands + delta.wsdWonHands,
    realizedWagerBb: existing.realizedWagerBb + delta.realizedWagerBb,
    allInAdjWagerBb: existing.allInAdjWagerBb + delta.allInAdjWagerBb,
    allInEquitySum: existing.allInEquitySum + delta.allInEquitySum,
    allInEquityCount: existing.allInEquityCount + delta.allInEquityCount,
    chartOkVpipHands: existing.chartOkVpipHands + delta.chartOkVpipHands,
    chartKnownVpipHands:
      existing.chartKnownVpipHands + delta.chartKnownVpipHands,
    limpHands: existing.limpHands + delta.limpHands,
    redlineBb: existing.redlineBb + delta.redlineBb,
    bluelineBb: existing.bluelineBb + delta.bluelineBb
  })
  const cache = derivedCache(merged)

  await tx.playerStyleStat.update({
    where: { id: existing.id },
    data: {
      ...incrementData,
      ...cache,
      lastMatchId: matchId,
      statsVersion: STYLE_STATS_VERSION
    }
  })
}

const upsertPopulationDelta = async (
  tx: Tx,
  args: { scope: string; deltas: HandStyleDelta[] }
) => {
  const { scope, deltas } = args
  const sum = deltas.reduce(
    (acc, d) => {
      for (const key of Object.keys(d) as (keyof HandStyleDelta)[]) {
        acc[key] = (acc[key] as number) + (d[key] as number)
      }
      return acc
    },
    {
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
      chartKnownVpipHands: 0,
      limpHands: 0,
      redlineBb: 0,
      bluelineBb: 0
    } as HandStyleDelta
  )

  const existing = await tx.stylePopulationStat.findUnique({
    where: { id: scope }
  })

  const opportunity = {
    hands: sum.hands,
    vpipHands: sum.vpipHands,
    pfrHands: sum.pfrHands,
    threeBetOpps: sum.threeBetOpps,
    threeBetHands: sum.threeBetHands,
    afqAggressive: sum.afqAggressive,
    afqActions: sum.afqActions,
    cbetOpps: sum.cbetOpps,
    cbetHands: sum.cbetHands,
    sawFlopHands: sum.sawFlopHands,
    wtsdHands: sum.wtsdHands,
    wsdWonHands: sum.wsdWonHands
  }

  if (!existing) {
    const popCounters: StyleCounters = {
      ...opportunity,
      realizedWagerBb: 0,
      allInAdjWagerBb: 0,
      allInEquitySum: 0,
      allInEquityCount: 0,
      chartOkVpipHands: 0,
      chartKnownVpipHands: 0,
      limpHands: 0,
      redlineBb: 0,
      bluelineBb: 0
    }
    const avgs = populationAvgCache(popCounters, null)
    await tx.stylePopulationStat.create({
      data: {
        id: scope,
        statsVersion: STYLE_STATS_VERSION,
        ...opportunity,
        skillEligibleUsers: 0,
        skillScoreSum: 0,
        ...avgs
      }
    })
    return
  }

  const popCounters: StyleCounters = {
    hands: existing.hands + opportunity.hands,
    vpipHands: existing.vpipHands + opportunity.vpipHands,
    pfrHands: existing.pfrHands + opportunity.pfrHands,
    threeBetOpps: existing.threeBetOpps + opportunity.threeBetOpps,
    threeBetHands: existing.threeBetHands + opportunity.threeBetHands,
    afqAggressive: existing.afqAggressive + opportunity.afqAggressive,
    afqActions: existing.afqActions + opportunity.afqActions,
    cbetOpps: existing.cbetOpps + opportunity.cbetOpps,
    cbetHands: existing.cbetHands + opportunity.cbetHands,
    sawFlopHands: existing.sawFlopHands + opportunity.sawFlopHands,
    wtsdHands: existing.wtsdHands + opportunity.wtsdHands,
    wsdWonHands: existing.wsdWonHands + opportunity.wsdWonHands,
    realizedWagerBb: 0,
    allInAdjWagerBb: 0,
    allInEquitySum: 0,
    allInEquityCount: 0,
    chartOkVpipHands: 0,
    chartKnownVpipHands: 0,
    limpHands: 0,
    redlineBb: 0,
    bluelineBb: 0
  }

  const avgSkill =
    existing.skillEligibleUsers > 0
      ? existing.skillScoreSum / existing.skillEligibleUsers
      : null
  const avgs = populationAvgCache(popCounters, avgSkill)

  await tx.stylePopulationStat.update({
    where: { id: scope },
    data: {
      hands: inc(opportunity.hands),
      vpipHands: inc(opportunity.vpipHands),
      pfrHands: inc(opportunity.pfrHands),
      threeBetOpps: inc(opportunity.threeBetOpps),
      threeBetHands: inc(opportunity.threeBetHands),
      afqAggressive: inc(opportunity.afqAggressive),
      afqActions: inc(opportunity.afqActions),
      cbetOpps: inc(opportunity.cbetOpps),
      cbetHands: inc(opportunity.cbetHands),
      sawFlopHands: inc(opportunity.sawFlopHands),
      wtsdHands: inc(opportunity.wtsdHands),
      wsdWonHands: inc(opportunity.wsdWonHands),
      statsVersion: STYLE_STATS_VERSION,
      ...avgs
    }
  })
}
