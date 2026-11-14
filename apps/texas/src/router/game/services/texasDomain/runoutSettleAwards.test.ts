import assert from 'node:assert/strict'
import { it, describe } from 'node:test'

import {
  computeRunWagers,
  runAwardsFromPoolMaps,
  mapsFromStoredRunAwards
} from './runoutSettleAwards'

describe('runoutSettleAwards', () => {
  it('computeRunWagers: HU equal stacks chop → ±half profit then net 0', () => {
    const runAwards: [Map<number, number>, Map<number, number>] = [
      new Map([[1, 20000]]),
      new Map([[2, 20000]])
    ]
    const a = computeRunWagers({
      userId: 1,
      totalBetAmount: 20000,
      potTotal: 40000,
      runAwards
    })
    const b = computeRunWagers({
      userId: 2,
      totalBetAmount: 20000,
      potTotal: 40000,
      runAwards
    })
    assert.deepEqual(a, [10000, -10000])
    assert.deepEqual(b, [-10000, 10000])
    assert.equal(a[0] + a[1], 0)
    assert.equal(b[0] + b[1], 0)
  })

  it('round-trips pool maps through stored JSON shape', () => {
    const maps: [Map<number, number>, Map<number, number>] = [
      new Map([[1, 500]]),
      new Map([
        [1, 250],
        [2, 250]
      ])
    ]
    const stored = runAwardsFromPoolMaps(maps)
    assert.ok(stored)
    const back = mapsFromStoredRunAwards(stored)
    assert.ok(back)
    assert.equal(back[0].get(1), 500)
    assert.equal(back[1].get(1), 250)
    assert.equal(back[1].get(2), 250)
  })
})
