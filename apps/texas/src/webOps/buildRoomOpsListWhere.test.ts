import assert from 'node:assert/strict'
import { it, describe } from 'node:test'

import { buildRoomOpsListWhere } from './buildRoomOpsListWhere'

describe('buildRoomOpsListWhere', () => {
  it('defaults to all rooms including soft-deleted', () => {
    const w = buildRoomOpsListWhere({})
    assert.equal(w.deletedAt, undefined)
  })

  it('active lifecycle keeps only non-deleted', () => {
    const w = buildRoomOpsListWhere({ lifecycle: 'active' })
    assert.deepEqual(w.deletedAt, null)
  })

  it('dissolved lifecycle requires deletedAt', () => {
    const w = buildRoomOpsListWhere({ lifecycle: 'dissolved' })
    assert.deepEqual(w.deletedAt, { not: null })
  })

  it('combines gameStatus, owner name, tableType', () => {
    const w = buildRoomOpsListWhere({
      gameStatus: 'waiting',
      ownerNameContains: '张',
      tableType: 'quick'
    })
    assert.equal(w.gameStatus, 'waiting')
    assert.deepEqual(w.owner, {
      is: { name: { contains: '张' } }
    })
    assert.equal(w.tableType, 'quick')
  })
})
