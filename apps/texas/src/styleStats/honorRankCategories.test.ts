import test from 'node:test'
import assert from 'node:assert/strict'

import { honorDeltaForSeat } from './playerHonors'
import {
  resolveHonorRankCategories,
  ranksFromSettlementRunSeats
} from './honorRankCategories'

test('honorDeltaForSeat counts each run big hand once; hands stay 1', () => {
  const d = honorDeltaForSeat({
    userId: 1,
    isFold: false,
    rankCategories: ['x', 'y', 'x']
  })
  assert.equal(d.hands, 1)
  assert.equal(d.fourOfKindCount, 2)
  assert.equal(d.straightFlushCount, 1)
  assert.equal(d.royalFlushCount, 0)
})

test('honorDeltaForSeat fold yields zeros', () => {
  const d = honorDeltaForSeat({
    userId: 1,
    isFold: true,
    rankCategories: ['z']
  })
  assert.equal(d.hands, 1)
  assert.equal(d.royalFlushCount, 0)
})

test('ranksFromSettlementRunSeats reads both runs', () => {
  const ranks = ranksFromSettlementRunSeats(
    [
      {
        runIndex: 1,
        seats: [
          { userId: 10, rankCategory: 'q' },
          { userId: 11, rankCategory: 'x' }
        ]
      },
      {
        runIndex: 2,
        seats: [
          { userId: 10, rankCategory: 'y' },
          { userId: 11, rankCategory: 'r' }
        ]
      }
    ],
    10
  )
  assert.deepEqual(ranks, ['q', 'y'])
})

test('resolveHonorRankCategories dual prefers seats over fallback', () => {
  const ranks = resolveHonorRankCategories({
    isFold: false,
    userId: 10,
    fallbackRank: 'r',
    handPokes: ['sa', 'sk'],
    runCount: 2,
    commonPokes: ['sq', 'sj', 'st', 's9', 's2'],
    commonPokesRun2: ['h2', 'd3', 'c4', 'c5', 'c6'],
    settlementRuns: [
      { runIndex: 1, seats: [{ userId: 10, rankCategory: 'z' }] },
      { runIndex: 2, seats: [{ userId: 10, rankCategory: 'x' }] }
    ]
  })
  assert.deepEqual(ranks, ['z', 'x'])
})

test('resolveHonorRankCategories single uses fallback', () => {
  const ranks = resolveHonorRankCategories({
    isFold: false,
    userId: 10,
    fallbackRank: 'y',
    handPokes: ['sa', 'sk'],
    runCount: 1
  })
  assert.deepEqual(ranks, ['y'])
})
