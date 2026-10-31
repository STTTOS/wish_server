import test from 'node:test'
import assert from 'node:assert/strict'

import { skillFromCounters } from './skill'
import { estimateHuEquity } from './equity'
import { emptyHandStyleDelta } from './types'
import { axesFromCounters } from './fromCounters'
import { computeHandStyleDeltas } from './handDelta'
import { isHoleInChart, normalizeHoleLabel } from './chartRanges'

test('normalizeHoleLabel: pairs and suited', () => {
  assert.equal(normalizeHoleLabel(['ha', 'sa']), 'aa')
  assert.equal(normalizeHoleLabel(['ha', 'hk']), 'AKs')
  assert.equal(normalizeHoleLabel(['ha', 'sk']), 'AKo')
})

test('isHoleInChart: UTG tight vs BTN wide', () => {
  assert.equal(isHoleInChart(['h2', 's7'], 'utg'), false)
  assert.equal(isHoleInChart(['ha', 'sk'], 'utg'), true)
  assert.equal(isHoleInChart(['h9', 'h8'], 'btn'), true)
})

test('computeHandStyleDeltas: limp call is VPIP not PFR', () => {
  const map = computeHandStyleDeltas({
    matchId: 1,
    lowestBetAmount: 2,
    boardPokes: ['h2', 'd3', 'c4', 's5', 'h6'],
    boardThroughStage: 'river',
    actions: [
      { userId: 1, actionType: 'call', amount: 2, stage: 'pre_flop' },
      { userId: 2, actionType: 'check', amount: 0, stage: 'pre_flop' },
      { userId: 1, actionType: 'check', amount: 0, stage: 'flop' },
      { userId: 2, actionType: 'check', amount: 0, stage: 'flop' },
      { userId: 1, actionType: 'fold', amount: 0, stage: 'turn' }
    ],
    seats: [
      {
        userId: 1,
        role: 'btn',
        handPokes: ['ha', 'sk'],
        wager: -2,
        isFold: true,
        isAllIn: false,
        wentToShowdown: false
      },
      {
        userId: 2,
        role: 'bb',
        handPokes: ['h2', 'c2'],
        wager: 2,
        isFold: false,
        isAllIn: false,
        wentToShowdown: false
      }
    ]
  })
  const d1 = map.get(1)!
  assert.equal(d1.hands, 1)
  assert.equal(d1.vpipHands, 1)
  assert.equal(d1.pfrHands, 0)
  assert.equal(d1.limpHands, 1)
  assert.equal(d1.chartOkVpipHands, 1)
})

test('computeHandStyleDeltas: AFq excludes fold from denominator', () => {
  const map = computeHandStyleDeltas({
    matchId: 5,
    lowestBetAmount: 2,
    boardPokes: ['h2', 'd3', 'c4'],
    boardThroughStage: 'flop',
    actions: [
      { userId: 1, actionType: 'raise', amount: 6, stage: 'pre_flop' },
      { userId: 2, actionType: 'call', amount: 4, stage: 'pre_flop' },
      { userId: 1, actionType: 'bet', amount: 4, stage: 'flop' },
      { userId: 2, actionType: 'fold', amount: 0, stage: 'flop' }
    ],
    seats: [
      {
        userId: 1,
        role: 'btn',
        handPokes: ['ha', 'hk'],
        wager: 10,
        isFold: false,
        isAllIn: false,
        wentToShowdown: false
      },
      {
        userId: 2,
        role: 'bb',
        handPokes: ['s2', 'c7'],
        wager: -10,
        isFold: true,
        isAllIn: false,
        wentToShowdown: false
      }
    ]
  })
  const d2 = map.get(2)!
  assert.equal(d2.afqActions, 0)
  assert.equal(d2.afqAggressive, 0)
  const d1 = map.get(1)!
  assert.equal(d1.afqActions, 1)
  assert.equal(d1.afqAggressive, 1)
})

test('computeHandStyleDeltas: postflop fold_win is sawFlop but not WTSD', () => {
  const map = computeHandStyleDeltas({
    matchId: 3,
    lowestBetAmount: 2,
    boardPokes: ['h2', 'd3', 'c4'],
    boardThroughStage: 'flop',
    actions: [
      { userId: 1, actionType: 'raise', amount: 6, stage: 'pre_flop' },
      { userId: 2, actionType: 'call', amount: 4, stage: 'pre_flop' },
      { userId: 1, actionType: 'bet', amount: 8, stage: 'flop' },
      { userId: 2, actionType: 'fold', amount: 0, stage: 'flop' }
    ],
    seats: [
      {
        userId: 1,
        role: 'btn',
        handPokes: ['ha', 'hk'],
        wager: 14,
        isFold: false,
        isAllIn: false,
        wentToShowdown: false
      },
      {
        userId: 2,
        role: 'bb',
        handPokes: ['s2', 'c7'],
        wager: -14,
        isFold: true,
        isAllIn: false,
        wentToShowdown: false
      }
    ]
  })
  const d1 = map.get(1)!
  assert.equal(d1.sawFlopHands, 1)
  assert.equal(d1.wtsdHands, 0)
  assert.equal(d1.wsdWonHands, 0)
  assert.equal(d1.redlineBb > 0, true)
  assert.equal(d1.bluelineBb, 0)
})

test('computeHandStyleDeltas: showdown counts WTSD and W$SD from pot wager', () => {
  const map = computeHandStyleDeltas({
    matchId: 4,
    lowestBetAmount: 2,
    boardPokes: ['h2', 'd3', 'c4', 's5', 'h6'],
    boardThroughStage: 'river',
    actions: [
      { userId: 1, actionType: 'raise', amount: 6, stage: 'pre_flop' },
      { userId: 2, actionType: 'call', amount: 4, stage: 'pre_flop' },
      { userId: 1, actionType: 'check', amount: 0, stage: 'flop' },
      { userId: 2, actionType: 'check', amount: 0, stage: 'flop' },
      { userId: 1, actionType: 'check', amount: 0, stage: 'turn' },
      { userId: 2, actionType: 'check', amount: 0, stage: 'turn' },
      { userId: 1, actionType: 'check', amount: 0, stage: 'river' },
      { userId: 2, actionType: 'check', amount: 0, stage: 'river' }
    ],
    seats: [
      {
        userId: 1,
        role: 'btn',
        handPokes: ['ha', 'sa'],
        wager: 6,
        isFold: false,
        isAllIn: false,
        wentToShowdown: true
      },
      {
        userId: 2,
        role: 'bb',
        handPokes: ['h2', 'c7'],
        wager: -6,
        isFold: false,
        isAllIn: false,
        wentToShowdown: true
      }
    ]
  })
  const d1 = map.get(1)!
  const d2 = map.get(2)!
  assert.equal(d1.wtsdHands, 1)
  assert.equal(d1.wsdWonHands, 1)
  assert.equal(d2.wtsdHands, 1)
  assert.equal(d2.wsdWonHands, 0)
})

test('computeHandStyleDeltas: open raise is PFR and cbet opp', () => {
  const map = computeHandStyleDeltas({
    matchId: 2,
    lowestBetAmount: 2,
    boardPokes: ['h2', 'd3', 'c4'],
    boardThroughStage: 'flop',
    actions: [
      { userId: 1, actionType: 'raise', amount: 6, stage: 'pre_flop' },
      { userId: 2, actionType: 'call', amount: 4, stage: 'pre_flop' },
      { userId: 1, actionType: 'bet', amount: 8, stage: 'flop' },
      { userId: 2, actionType: 'fold', amount: 0, stage: 'flop' }
    ],
    seats: [
      {
        userId: 1,
        role: 'btn',
        handPokes: ['ha', 'hk'],
        wager: 14,
        isFold: false,
        isAllIn: false,
        wentToShowdown: false
      },
      {
        userId: 2,
        role: 'bb',
        handPokes: ['s2', 'c7'],
        wager: -14,
        isFold: true,
        isAllIn: false,
        wentToShowdown: false
      }
    ]
  })
  const d1 = map.get(1)!
  assert.equal(d1.pfrHands, 1)
  assert.equal(d1.cbetOpps, 1)
  assert.equal(d1.cbetHands, 1)
  assert.equal(d1.redlineBb > 0, true)
})

test('axesFromCounters and skillFromCounters produce finite scores', () => {
  const c = {
    ...emptyHandStyleDelta(),
    hands: 100,
    vpipHands: 25,
    pfrHands: 20,
    threeBetOpps: 40,
    threeBetHands: 4,
    afqAggressive: 30,
    afqActions: 80,
    cbetOpps: 20,
    cbetHands: 12,
    sawFlopHands: 40,
    wtsdHands: 10,
    wsdWonHands: 6,
    realizedWagerBb: 50,
    allInAdjWagerBb: 40,
    allInEquitySum: 6,
    allInEquityCount: 10,
    chartOkVpipHands: 20,
    limpHands: 2,
    redlineBb: 30,
    bluelineBb: 10
  }
  const axes = axesFromCounters(c)
  assert.equal(axes.axisVpip, 25)
  assert.equal(axes.axisPfr, 20)
  const skill = skillFromCounters(c)
  assert.ok(skill.skillScore >= 0 && skill.skillScore <= 100)
})

test('estimateHuEquity: AA vs 72o on empty board favors AA', () => {
  const eq = estimateHuEquity(['ha', 'sa'], ['h2', 'c7'], [])
  assert.ok(eq != null && eq > 0.75)
})
