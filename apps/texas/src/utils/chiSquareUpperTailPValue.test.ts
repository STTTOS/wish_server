import test from 'node:test'
import assert from 'node:assert/strict'

import { chiSquareUpperTailPValue } from './chiSquareUpperTailPValue'

test('chiSquareUpperTailPValue: df=51 critical ~68.7 gives p≈0.05', () => {
  const p = chiSquareUpperTailPValue(68.7, 51)
  assert.ok(p > 0.04 && p < 0.06, `p=${p}`)
})

test('chiSquareUpperTailPValue: small statistic gives large p', () => {
  const p = chiSquareUpperTailPValue(10, 51)
  assert.ok(p > 0.9)
})

test('chiSquareUpperTailPValue: edge non-positive', () => {
  assert.equal(chiSquareUpperTailPValue(0, 51), 1)
  assert.equal(chiSquareUpperTailPValue(5, 0), 1)
})
