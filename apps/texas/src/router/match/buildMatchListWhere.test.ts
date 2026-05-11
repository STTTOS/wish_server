import assert from 'node:assert/strict'
import { it, describe } from 'node:test'

import { buildMatchListWhere } from './buildMatchListWhere'

describe('buildMatchListWhere', () => {
  it('restricts non-admin to viewer matches', () => {
    const w = buildMatchListWhere({
      viewerUserId: 42,
      isAdmin: false,
      participantNameContains: 'ignored'
    })
    assert.deepEqual(w.playerMatchRecords, { some: { userId: 42 } })
  })

  it('admin + participantName filters by user name', () => {
    const w = buildMatchListWhere({
      viewerUserId: 1,
      isAdmin: true,
      participantNameContains: 'alice'
    })
    assert.deepEqual(w.playerMatchRecords, {
      some: { user: { name: { contains: 'alice' } } }
    })
  })

  it('admin without name has no playerMatchRecords clause', () => {
    const w = buildMatchListWhere({
      viewerUserId: 1,
      isAdmin: true
    })
    assert.equal(w.playerMatchRecords, undefined)
  })

  it('filters in_progress by endedAt null', () => {
    const w = buildMatchListWhere({
      viewerUserId: 1,
      isAdmin: true,
      matchProgress: 'in_progress'
    })
    assert.deepEqual(w.endedAt, null)
  })

  it('filters ended by endedAt not null', () => {
    const w = buildMatchListWhere({
      viewerUserId: 1,
      isAdmin: true,
      matchProgress: 'ended'
    })
    assert.deepEqual(w.endedAt, { not: null })
  })

  it('filters by boardThroughStage', () => {
    const w = buildMatchListWhere({
      viewerUserId: 1,
      isAdmin: true,
      boardThroughStage: 'river'
    })
    assert.equal(w.boardThroughStage, 'river')
  })

  it('combines tableType and timeRange', () => {
    const start = new Date('2024-01-01T00:00:00Z')
    const end = new Date('2024-01-02T00:00:00Z')
    const w = buildMatchListWhere({
      viewerUserId: 1,
      isAdmin: true,
      tableType: 'quick',
      timeRange: { start, end }
    })
    assert.ok(
      w.room &&
        typeof w.room === 'object' &&
        'is' in w.room &&
        (w.room as { is: { tableType: string } }).is.tableType === 'quick'
    )
    assert.deepEqual(w.startedAt, { gte: start, lte: end })
  })
})
