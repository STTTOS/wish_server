import test from 'node:test'
import assert from 'node:assert/strict'

import { computePotOdds } from './potOdds'
import { scoreDisciplineNode } from './scoreNode'
import { buildDecisionSnapshot } from './buildSnapshotFields'
import {
  habitScoreFromSignals,
  combineDisciplineScore,
  aggregateHandDiscipline,
  aggregatePlayerActionDiscipline
} from './aggregate'

test('computePotOdds: call 5 into pot 10 → 1/3', () => {
  assert.ok(Math.abs((computePotOdds(10, 5) ?? 0) - 5 / 15) < 1e-9)
  assert.equal(computePotOdds(10, 0), null)
})

test('forced action is skip', () => {
  const snap = buildDecisionSnapshot({
    matchId: 1,
    userId: 1,
    actionIndex: 0,
    street: 'preflop',
    playersInHand: 6,
    heroPosition: 'bb',
    potBb: 1.5,
    toCallBb: 0,
    lineTag: 'unopened',
    actionType: 'call',
    actionSizeBb: 0.5,
    isForced: true
  })
  const r = scoreDisciplineNode(snap)
  assert.equal(r.tier, 'skip')
  assert.equal(r.score, null)
})

test('BTN unopened raise is clean (no reward for aggression)', () => {
  const snap = buildDecisionSnapshot({
    matchId: 1,
    userId: 1,
    actionIndex: 1,
    street: 'preflop',
    playersInHand: 3,
    heroPosition: 'btn',
    potBb: 1.5,
    toCallBb: 1,
    lineTag: 'unopened',
    actionType: 'raise',
    actionSizeBb: 2.5,
    isForced: false
  })
  assert.equal(scoreDisciplineNode(snap).tier, 'clean')
})

test('unopened limp is hard_leak', () => {
  const snap = buildDecisionSnapshot({
    matchId: 1,
    userId: 2,
    actionIndex: 2,
    street: 'preflop',
    playersInHand: 5,
    heroPosition: 'mp',
    potBb: 1.5,
    toCallBb: 1,
    lineTag: 'unopened',
    actionType: 'call',
    actionSizeBb: 1,
    isForced: false
  })
  assert.equal(scoreDisciplineNode(snap).tier, 'hard_leak')
})

test('bad pot odds call is hard_leak or severe', () => {
  const snap = buildDecisionSnapshot({
    matchId: 1,
    userId: 3,
    actionIndex: 3,
    street: 'river',
    playersInHand: 2,
    heroPosition: 'bb',
    potBb: 10,
    toCallBb: 12,
    lineTag: 'vs_bet',
    actionType: 'call',
    actionSizeBb: 12,
    isForced: false
  })
  const r = scoreDisciplineNode(snap)
  assert.ok(r.tier === 'hard_leak' || r.tier === 'severe')
  assert.equal(r.dimension, 'odds')
})

test('PFR flop bet is clean (not rewarded as skill)', () => {
  const snap = buildDecisionSnapshot({
    matchId: 1,
    userId: 1,
    actionIndex: 4,
    street: 'flop',
    playersInHand: 2,
    heroPosition: 'btn',
    potBb: 6.5,
    toCallBb: 0,
    lineTag: 'as_pfr',
    actionType: 'bet',
    actionSizeBb: 4,
    isForced: false
  })
  assert.equal(scoreDisciplineNode(snap).tier, 'clean')
})

test('aggregate hand and player discipline', () => {
  const nodes = [
    scoreDisciplineNode(
      buildDecisionSnapshot({
        matchId: 1,
        userId: 1,
        actionIndex: 0,
        street: 'preflop',
        playersInHand: 3,
        heroPosition: 'btn',
        potBb: 1.5,
        toCallBb: 1,
        lineTag: 'unopened',
        actionType: 'raise',
        actionSizeBb: 2.5,
        isForced: false
      })
    ),
    scoreDisciplineNode(
      buildDecisionSnapshot({
        matchId: 1,
        userId: 1,
        actionIndex: 1,
        street: 'preflop',
        playersInHand: 6,
        heroPosition: 'bb',
        potBb: 1.5,
        toCallBb: 0,
        lineTag: 'unopened',
        actionType: 'call',
        actionSizeBb: 0.5,
        isForced: true
      })
    )
  ]
  const hand = aggregateHandDiscipline(nodes)
  assert.equal(hand.scoredNodes, 1)
  assert.equal(hand.skippedNodes, 1)
  assert.ok(hand.handDiscipline != null && hand.handDiscipline >= 99)

  const player = aggregatePlayerActionDiscipline([
    hand.handDiscipline,
    70,
    null
  ])
  assert.ok(player != null && player > 70 && player < 100)

  const habit = habitScoreFromSignals({
    limpRate: 0.25,
    highVpip: true,
    callingStation: false,
    lowPfrRatio: true
  })
  assert.ok(habit < 70)

  const score = combineDisciplineScore(player, { habitScore: habit })
  assert.ok(score != null && score > 0 && score <= 100)
})
