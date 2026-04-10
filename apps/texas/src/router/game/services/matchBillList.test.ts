import test from 'node:test'
import assert from 'node:assert/strict'

import {
  type NetPosition,
  normalizeIntegerZeroSum,
  assertBillsSettlePositions,
  buildBillListFromNetByUser
} from './matchBillList'

function billsCoverExample(
  bills: { fromUserId: number; toUserId: number; amount: number }[],
  expected: { from: number; to: number; amount: number }[]
): void {
  assert.equal(bills.length, expected.length, 'bill count')
  const rest = [...bills]
  for (const e of expected) {
    const idx = rest.findIndex(
      (b) =>
        b.fromUserId === e.from && b.toUserId === e.to && b.amount === e.amount
    )
    assert.ok(idx >= 0, `missing bill ${e.from}->${e.to} ${e.amount}`)
    rest.splice(idx, 1)
  }
  assert.equal(rest.length, 0, 'unexpected extra bills')
}

test('user example: a +3000 b -2000 c -1500 d +500', () => {
  const raw: NetPosition[] = [
    { userId: 1, net: 3000 },
    { userId: 2, net: -2000 },
    { userId: 3, net: -1500 },
    { userId: 4, net: 500 }
  ]
  const norm = normalizeIntegerZeroSum(raw)
  const bills = buildBillListFromNetByUser(norm)
  assertBillsSettlePositions(norm, bills)
  billsCoverExample(bills, [
    { from: 2, to: 1, amount: 2000 },
    { from: 3, to: 1, amount: 1000 },
    { from: 3, to: 4, amount: 500 }
  ])
})

test('two players: b pays a', () => {
  const norm = normalizeIntegerZeroSum([
    { userId: 10, net: 100 },
    { userId: 20, net: -100 }
  ])
  const bills = buildBillListFromNetByUser(norm)
  assertBillsSettlePositions(norm, bills)
  billsCoverExample(bills, [{ from: 20, to: 10, amount: 100 }])
})

test('all zero: empty bill list', () => {
  const norm = normalizeIntegerZeroSum([
    { userId: 1, net: 0 },
    { userId: 2, net: 0 }
  ])
  const bills = buildBillListFromNetByUser(norm)
  assert.deepEqual(bills, [])
})

test('empty positions', () => {
  assert.deepEqual(buildBillListFromNetByUser([]), [])
  assert.deepEqual(normalizeIntegerZeroSum([]), [])
})

test('normalize fixes rounding drift to zero sum', () => {
  const norm = normalizeIntegerZeroSum([
    { userId: 1, net: 0.4 },
    { userId: 2, net: 0.4 },
    { userId: 3, net: -0.8 }
  ])
  const sum = norm.reduce((s, p) => s + p.net, 0)
  assert.equal(sum, 0)
  const bills = buildBillListFromNetByUser(norm)
  assertBillsSettlePositions(norm, bills)
})

test('five players mixed', () => {
  const norm = normalizeIntegerZeroSum([
    { userId: 1, net: 500 },
    { userId: 2, net: 300 },
    { userId: 3, net: -400 },
    { userId: 4, net: -250 },
    { userId: 5, net: -150 }
  ])
  const bills = buildBillListFromNetByUser(norm)
  assertBillsSettlePositions(norm, bills)
})

test('throws if sum(net) !== 0 after normalize bypass', () => {
  assert.throws(
    () =>
      buildBillListFromNetByUser([
        { userId: 1, net: 100 },
        { userId: 2, net: -50 }
      ]),
    /sum\(net\) must be 0/
  )
})

test('large chain settlement', () => {
  const norm = normalizeIntegerZeroSum([
    { userId: 1, net: 9000 },
    { userId: 2, net: -3000 },
    { userId: 3, net: -3000 },
    { userId: 4, net: -3000 }
  ])
  const bills = buildBillListFromNetByUser(norm)
  assertBillsSettlePositions(norm, bills)
  assert.equal(bills.length, 3)
})

test('deterministic: same input yields same bills', () => {
  const norm = normalizeIntegerZeroSum([
    { userId: 5, net: -100 },
    { userId: 3, net: 50 },
    { userId: 7, net: 50 }
  ])
  const a = buildBillListFromNetByUser(norm)
  const b = buildBillListFromNetByUser(norm)
  assert.deepEqual(a, b)
})
