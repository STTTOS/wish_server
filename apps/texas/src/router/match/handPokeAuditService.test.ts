import test from 'node:test'
import assert from 'node:assert/strict'

import { HandPokeAuditStatus } from './handPokeAuditConstants'
import { aggregateHandPokeAuditFromRows } from './handPokeAuditService'

test('aggregate: invalid rows skipped; insufficient below 150 hands', () => {
  const rows = [
    { handPokes: null },
    { handPokes: [] },
    { handPokes: ['h2'] },
    { handPokes: ['h2', 'h2'] },
    { handPokes: ['xx', 'h3'] },
    { handPokes: ['h2', 'h3'] }
  ]
  const agg = aggregateHandPokeAuditFromRows(rows)
  assert.equal(agg.validHandCount, 1)
  assert.equal(agg.totalValidCards, 2)
  assert.equal(agg.auditStatus, HandPokeAuditStatus.insufficient_data)
  assert.equal(agg.chiSquare, null)
  assert.equal(agg.pValue, null)
  assert.equal(agg.heatmapScaleEnabled, false)
})

test('aggregate: 150 identical structure hands yields computed chiSquare', () => {
  const hand = ['h2', 'h3'] as [string, string]
  const rows = Array.from({ length: 150 }, () => ({ handPokes: [...hand] }))
  const agg = aggregateHandPokeAuditFromRows(rows)
  assert.equal(agg.validHandCount, 150)
  assert.equal(agg.auditStatus, HandPokeAuditStatus.abnormal)
  assert.ok(agg.chiSquare != null && agg.chiSquare > 0)
  assert.ok(agg.pValue != null && agg.pValue < 0.05)
  assert.equal(agg.heatmapScaleEnabled, true)
})
