import test from 'node:test'
import assert from 'node:assert/strict'

import { scoreDisciplineNode } from './engine'
import { projectDecisionSnapshots } from './projectSnapshots'

const seats3 = [
  { userId: 1, role: 'btn' as const },
  { userId: 2, role: 'sb' as const },
  { userId: 3, role: 'bb' as const }
]

test('blinds do not open the pot; limp is unopened hard_leak', () => {
  const rows = projectDecisionSnapshots({
    matchId: 1,
    lowestBetAmount: 2,
    seats: seats3,
    records: [
      {
        userId: 2,
        actionType: 'bet',
        amount: 1,
        stage: 'pre_flop',
        source: 'blind'
      },
      {
        userId: 3,
        actionType: 'bet',
        amount: 2,
        stage: 'pre_flop',
        source: 'blind'
      },
      {
        userId: 1,
        actionType: 'call',
        amount: 2,
        stage: 'pre_flop',
        source: 'action'
      }
    ]
  })
  assert.equal(rows.length, 1)
  const limp = rows[0]!
  assert.equal(limp.lineTag, 'unopened')
  assert.equal(limp.toCallBb, 1)
  assert.equal(limp.potBb, 1.5)
  assert.equal(scoreDisciplineNode(limp).tier, 'hard_leak')
})

test('BTN unopened raise after blinds is clean (no aggression reward)', () => {
  const rows = projectDecisionSnapshots({
    matchId: 2,
    lowestBetAmount: 2,
    seats: seats3,
    records: [
      {
        userId: 2,
        actionType: 'bet',
        amount: 1,
        stage: 'pre_flop',
        source: 'blind'
      },
      {
        userId: 3,
        actionType: 'bet',
        amount: 2,
        stage: 'pre_flop',
        source: 'blind'
      },
      {
        userId: 1,
        actionType: 'raise',
        amount: 6,
        stage: 'pre_flop',
        source: 'action'
      }
    ]
  })
  const open = rows[0]!
  assert.equal(open.lineTag, 'unopened')
  assert.equal(open.heroPosition, 'btn')
  assert.equal(scoreDisciplineNode(open).tier, 'clean')
})

test('PFR flop cbet tagged as_pfr', () => {
  const rows = projectDecisionSnapshots({
    matchId: 3,
    lowestBetAmount: 2,
    seats: seats3,
    records: [
      {
        userId: 2,
        actionType: 'bet',
        amount: 1,
        stage: 'pre_flop',
        source: 'blind'
      },
      {
        userId: 3,
        actionType: 'bet',
        amount: 2,
        stage: 'pre_flop',
        source: 'blind'
      },
      {
        userId: 1,
        actionType: 'raise',
        amount: 6,
        stage: 'pre_flop',
        source: 'action'
      },
      {
        userId: 2,
        actionType: 'fold',
        amount: 0,
        stage: 'pre_flop',
        source: 'action'
      },
      {
        userId: 3,
        actionType: 'call',
        amount: 4,
        stage: 'pre_flop',
        source: 'action'
      },
      {
        userId: 3,
        actionType: 'check',
        amount: 0,
        stage: 'flop',
        source: 'action'
      },
      {
        userId: 1,
        actionType: 'bet',
        amount: 8,
        stage: 'flop',
        source: 'action'
      }
    ]
  })
  const cbet = rows.find(
    (r) => r.street === 'flop' && r.userId === 1 && r.actionType === 'bet'
  )
  assert.ok(cbet)
  assert.equal(cbet!.lineTag, 'as_pfr')
  assert.equal(scoreDisciplineNode(cbet!).tier, 'clean')
})

test('fold facing bet keeps toCall for potOdds', () => {
  const rows = projectDecisionSnapshots({
    matchId: 4,
    lowestBetAmount: 2,
    seats: [
      { userId: 1, role: 'btn' },
      { userId: 3, role: 'bb' }
    ],
    records: [
      {
        userId: 1,
        actionType: 'bet',
        amount: 1,
        stage: 'pre_flop',
        source: 'blind'
      },
      {
        userId: 3,
        actionType: 'bet',
        amount: 2,
        stage: 'pre_flop',
        source: 'blind'
      },
      {
        userId: 1,
        actionType: 'raise',
        amount: 6,
        stage: 'pre_flop',
        source: 'action'
      },
      {
        userId: 3,
        actionType: 'call',
        amount: 4,
        stage: 'pre_flop',
        source: 'action'
      },
      {
        userId: 3,
        actionType: 'check',
        amount: 0,
        stage: 'river',
        source: 'action'
      },
      {
        userId: 1,
        actionType: 'bet',
        amount: 2,
        stage: 'river',
        source: 'action'
      },
      {
        userId: 3,
        actionType: 'fold',
        amount: 0,
        stage: 'river',
        source: 'action'
      }
    ]
  })
  const fold = rows.find((r) => r.actionType === 'fold' && r.street === 'river')
  assert.ok(fold)
  assert.ok((fold!.toCallBb ?? 0) > 0)
  assert.ok(fold!.potOdds != null)
})
