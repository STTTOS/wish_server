import test from 'node:test'
import assert from 'node:assert/strict'

import { computePotOdds } from './potOdds'
import { scoreDecisionNode } from './scoreNode'
import { classifyBoardTexture } from './boardTexture'
import { buildDecisionSnapshot } from './buildSnapshotFields'
import {
  aggregateHandTech,
  combinePlayerTech,
  structureScoreFromSignals,
  aggregatePlayerTechFromHands
} from './aggregate'

test('computePotOdds: call 5 into pot 10 → 1/3', () => {
  assert.ok(Math.abs((computePotOdds(10, 5) ?? 0) - 5 / 15) < 1e-9)
  assert.equal(computePotOdds(10, 0), null)
})

test('classifyBoardTexture: three same suit → wet', () => {
  assert.equal(classifyBoardTexture(['ha', 'h9', 'h2']), 'wet')
})

test('forced action is skip', () => {
  const snap = buildDecisionSnapshot({
    matchId: 1,
    userId: 1,
    actionIndex: 0,
    street: 'preflop',
    playersInHand: 6,
    heroPosition: 'bb',
    heroStackBb: 100,
    potBb: 1.5,
    toCallBb: 0,
    lineTag: 'unopened',
    aggressorIsHero: false,
    actionType: 'call',
    actionSizeBb: 0.5,
    isForced: true
  })
  const r = scoreDecisionNode(snap)
  assert.equal(r.tier, 'skip')
  assert.equal(r.score, null)
})

test('BTN unopened raise scores best', () => {
  const snap = buildDecisionSnapshot({
    matchId: 1,
    userId: 1,
    actionIndex: 1,
    street: 'preflop',
    playersInHand: 3,
    heroPosition: 'btn',
    heroStackBb: 100,
    potBb: 1.5,
    toCallBb: 1,
    lineTag: 'unopened',
    aggressorIsHero: false,
    actionType: 'raise',
    actionSizeBb: 2.5,
    isForced: false
  })
  assert.equal(scoreDecisionNode(snap).tier, 'best')
})

test('unopened limp is mistake', () => {
  const snap = buildDecisionSnapshot({
    matchId: 1,
    userId: 2,
    actionIndex: 2,
    street: 'preflop',
    playersInHand: 5,
    heroPosition: 'mp',
    heroStackBb: 80,
    potBb: 1.5,
    toCallBb: 1,
    lineTag: 'unopened',
    aggressorIsHero: false,
    actionType: 'call',
    actionSizeBb: 1,
    isForced: false
  })
  assert.equal(scoreDecisionNode(snap).tier, 'mistake')
})

test('bad pot odds call is mistake', () => {
  const snap = buildDecisionSnapshot({
    matchId: 1,
    userId: 3,
    actionIndex: 3,
    street: 'river',
    playersInHand: 2,
    heroPosition: 'bb',
    heroStackBb: 50,
    potBb: 10,
    toCallBb: 12,
    boardPokes: ['sa', 'hk', 'c2', 'd7', 's3'],
    lineTag: 'vs_bet',
    aggressorIsHero: false,
    actionType: 'call',
    actionSizeBb: 12,
    isForced: false
  })
  const r = scoreDecisionNode(snap)
  assert.equal(r.tier, 'mistake')
  assert.equal(r.dimension, 'odds')
})

test('PFR dry flop cbet is best', () => {
  const snap = buildDecisionSnapshot({
    matchId: 1,
    userId: 1,
    actionIndex: 4,
    street: 'flop',
    playersInHand: 2,
    heroPosition: 'btn',
    heroStackBb: 90,
    potBb: 6.5,
    toCallBb: 0,
    boardPokes: ['sa', 'c7', 'd2'],
    lineTag: 'as_pfr',
    aggressorIsHero: true,
    actionType: 'bet',
    actionSizeBb: 4,
    isForced: false
  })
  assert.equal(scoreDecisionNode(snap).tier, 'best')
})

test('aggregate hand and player tech', () => {
  const nodes = [
    scoreDecisionNode(
      buildDecisionSnapshot({
        matchId: 1,
        userId: 1,
        actionIndex: 0,
        street: 'preflop',
        playersInHand: 3,
        heroPosition: 'btn',
        heroStackBb: 100,
        potBb: 1.5,
        toCallBb: 1,
        lineTag: 'unopened',
        aggressorIsHero: false,
        actionType: 'raise',
        actionSizeBb: 2.5,
        isForced: false
      })
    ),
    scoreDecisionNode(
      buildDecisionSnapshot({
        matchId: 1,
        userId: 1,
        actionIndex: 1,
        street: 'preflop',
        playersInHand: 6,
        heroPosition: 'bb',
        heroStackBb: 100,
        potBb: 1.5,
        toCallBb: 0,
        lineTag: 'unopened',
        aggressorIsHero: false,
        actionType: 'call',
        actionSizeBb: 0.5,
        isForced: true
      })
    )
  ]
  const hand = aggregateHandTech(nodes)
  assert.equal(hand.scoredNodes, 1)
  assert.equal(hand.skippedNodes, 1)
  assert.ok(hand.handTech != null && hand.handTech >= 90)

  const player = aggregatePlayerTechFromHands([hand.handTech, 70, null])
  assert.ok(player != null && player > 70 && player < 100)

  const structure = structureScoreFromSignals({
    limpRate: 0.25,
    highVpip: true,
    callingStation: false,
    lowPfrRatio: true
  })
  assert.ok(structure < 70)

  const tech = combinePlayerTech(player, { structureScore: structure })
  assert.ok(tech != null && tech > 0 && tech <= 100)
})
