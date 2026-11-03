import type { DisciplineProvider } from './types'

import test from 'node:test'
import assert from 'node:assert/strict'

import { buildDecisionSnapshot } from '../buildSnapshotFields'
import {
  disciplineRulesProvider,
  getActiveDisciplineProvider,
  setActiveDisciplineProvider,
  resetActiveDisciplineProvider
} from './index'

test('default provider is discipline rules', () => {
  resetActiveDisciplineProvider()
  assert.equal(getActiveDisciplineProvider().id, disciplineRulesProvider.id)
})

test('setActiveDisciplineProvider swaps engine', () => {
  const fake: DisciplineProvider = {
    id: 'test-stub',
    evaluate: () => ({
      rulesVersion: 'test-stub',
      node: {
        tier: 'soft_leak',
        score: 70,
        weight: 1,
        reason: 'stub',
        rulesVersion: 'test-stub',
        dimension: 'none'
      }
    })
  }
  setActiveDisciplineProvider(fake)
  assert.equal(getActiveDisciplineProvider().id, 'test-stub')
  const out = getActiveDisciplineProvider().evaluate(
    buildDecisionSnapshot({
      matchId: 1,
      userId: 1,
      actionIndex: 0,
      street: 'preflop',
      playersInHand: 2,
      heroPosition: 'btn',
      potBb: 2,
      toCallBb: 0,
      lineTag: 'unopened',
      actionType: 'check',
      actionSizeBb: 0,
      isForced: false
    })
  )
  assert.equal(out.node.tier, 'soft_leak')
  resetActiveDisciplineProvider()
})
