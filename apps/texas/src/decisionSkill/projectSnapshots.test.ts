import test from 'node:test'
import assert from 'node:assert/strict'

import { scoreDecisionNode } from './engine'
import {
  boardPokesForStreet,
  projectDecisionSnapshots
} from './projectSnapshots'

const seats3 = [
  { userId: 1, role: 'btn' as const, balanceStart: 200 },
  { userId: 2, role: 'sb' as const, balanceStart: 200 },
  { userId: 3, role: 'bb' as const, balanceStart: 200 }
]

test('boardPokesForStreet truncates by street', () => {
  const all = ['sa', 'hk', 'c2', 'd7', 's3']
  assert.deepEqual(boardPokesForStreet('pre_flop', all), [])
  assert.deepEqual(boardPokesForStreet('flop', all), ['sa', 'hk', 'c2'])
  assert.deepEqual(boardPokesForStreet('turn', all), ['sa', 'hk', 'c2', 'd7'])
  assert.deepEqual(boardPokesForStreet('river', all), all)
})

test('blinds do not open the pot; limp is unopened mistake', () => {
  const rows = projectDecisionSnapshots({
    matchId: 1,
    lowestBetAmount: 2,
    boardPokes: ['sa', 'hk', 'c2', 'd7', 's3'],
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
  assert.equal(scoreDecisionNode(limp).tier, 'mistake')
})

test('BTN unopened raise after blinds scores best', () => {
  const rows = projectDecisionSnapshots({
    matchId: 2,
    lowestBetAmount: 2,
    boardPokes: [],
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
  assert.equal(scoreDecisionNode(open).tier, 'best')
})

test('PFR dry flop cbet tagged as_pfr with truncated board', () => {
  const rows = projectDecisionSnapshots({
    matchId: 3,
    lowestBetAmount: 2,
    boardPokes: ['sa', 'c7', 'd2', 'h9', 'sk'],
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
  assert.equal(cbet!.aggressorIsHero, true)
  assert.deepEqual(cbet!.boardPokes, ['sa', 'c7', 'd2'])
  assert.equal(cbet!.boardTexture, 'dry')
  assert.equal(scoreDecisionNode(cbet!).tier, 'best')
})

test('fold facing bet keeps toCall for potOdds', () => {
  const rows = projectDecisionSnapshots({
    matchId: 4,
    lowestBetAmount: 2,
    boardPokes: ['sa', 'hk', 'c2', 'd7', 's3'],
    seats: [
      { userId: 1, role: 'btn', balanceStart: 200 },
      { userId: 3, role: 'bb', balanceStart: 200 }
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
