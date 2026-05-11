import assert from 'node:assert/strict'
import { it, describe } from 'node:test'

import { buildRoomOpsListWhere } from './buildRoomOpsListWhere'

describe('buildRoomOpsListWhere', () => {
  it('always excludes soft-deleted rooms', () => {
    const w = buildRoomOpsListWhere({})
    assert.deepEqual(w.deletedAt, null)
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
