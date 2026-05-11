import assert from 'node:assert/strict'
import { it, describe } from 'node:test'

import { orderByForUserOpsList } from './userOpsListOrderBy'

describe('orderByForUserOpsList', () => {
  it('defaults to id desc', () => {
    assert.deepEqual(orderByForUserOpsList({}), { id: 'desc' })
  })

  it('orders by matchRecords count asc', () => {
    assert.deepEqual(
      orderByForUserOpsList({
        sortField: 'matchRecordsCount',
        sortOrder: 'asc'
      }),
      { matchRecords: { _count: 'asc' } }
    )
  })

  it('ignores invalid sortField', () => {
    assert.deepEqual(
      orderByForUserOpsList({ sortField: 'name', sortOrder: 'asc' }),
      { id: 'desc' }
    )
  })
})
