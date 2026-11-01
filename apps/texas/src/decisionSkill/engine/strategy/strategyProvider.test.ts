import type { StrategyProvider } from './types'

import test from 'node:test'
import assert from 'node:assert/strict'

import { buildDecisionSnapshot } from '../buildSnapshotFields'
import {
  rulesP0StrategyProvider,
  getActiveStrategyProvider,
  setActiveStrategyProvider,
  resetActiveStrategyProvider
} from './index'

test('active provider defaults to rules P0', () => {
  resetActiveStrategyProvider()
  assert.equal(getActiveStrategyProvider().id, rulesP0StrategyProvider.id)
})

test('evaluate exposes congruence aligned with tier score', () => {
  resetActiveStrategyProvider()
  const snap = buildDecisionSnapshot({
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
  const ev = getActiveStrategyProvider().evaluate(snap)
  assert.equal(ev.source, 'rules')
  assert.equal(ev.node.tier, 'best')
  assert.equal(ev.congruence, 1)
  assert.equal(ev.evLossBb, null)
})

test('setActiveStrategyProvider swaps engine without changing callers', () => {
  const fake: StrategyProvider = {
    id: 'test-stub',
    evaluate: () => ({
      strategyVersion: 'test-stub',
      source: 'rules',
      congruence: 0.5,
      evLossBb: 1.2,
      node: {
        tier: 'correct',
        score: 85,
        weight: 1,
        reason: 'stub',
        strategyVersion: 'test-stub',
        dimension: 'line'
      },
      recommendations: [{ actionType: 'fold', frequency: 1 }]
    })
  }
  setActiveStrategyProvider(fake)
  assert.equal(getActiveStrategyProvider().id, 'test-stub')
  const out = getActiveStrategyProvider().evaluate(
    buildDecisionSnapshot({
      matchId: 1,
      userId: 1,
      actionIndex: 0,
      street: 'preflop',
      playersInHand: 2,
      heroPosition: 'bb',
      heroStackBb: 100,
      potBb: 2,
      toCallBb: 0,
      lineTag: 'other',
      aggressorIsHero: false,
      actionType: 'check',
      actionSizeBb: 0,
      isForced: false
    })
  )
  assert.equal(out.congruence, 0.5)
  assert.equal(out.evLossBb, 1.2)
  assert.equal(out.recommendations?.[0]?.actionType, 'fold')
  resetActiveStrategyProvider()
})
