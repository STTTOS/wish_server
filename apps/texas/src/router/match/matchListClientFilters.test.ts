import assert from 'node:assert/strict'
import { it, describe } from 'node:test'

import {
  parseMatchListSort,
  resolveStartedAtFilter,
  resolveBoardStageFilter,
  resolveMatchListOrderBy,
  parseMatchListRankFilter,
  parseMatchListMemberCount
} from './matchListClientFilters'

describe('matchListClientFilters', () => {
  it('parseMatchListRankFilter defaults and rejects junk', () => {
    assert.equal(parseMatchListRankFilter(undefined), 'all')
    assert.equal(parseMatchListRankFilter('unmade'), 'unmade')
    assert.equal(parseMatchListRankFilter('x'), 'x')
    assert.equal(parseMatchListRankFilter('nope'), null)
  })

  it('parseMatchListMemberCount accepts 2–10', () => {
    assert.equal(parseMatchListMemberCount('all'), 'all')
    assert.equal(parseMatchListMemberCount(6), 6)
    assert.equal(parseMatchListMemberCount(1), null)
    assert.equal(parseMatchListMemberCount(11), null)
  })

  it('resolveBoardStageFilter forces pre_flop for unmade', () => {
    assert.equal(resolveBoardStageFilter('unmade', 'all'), 'pre_flop')
    assert.equal(resolveBoardStageFilter('unmade', 'pre_flop'), 'pre_flop')
    assert.equal(resolveBoardStageFilter('unmade', 'river'), null)
    assert.equal(resolveBoardStageFilter('all', 'flop'), 'flop')
    assert.equal(resolveBoardStageFilter('all', 'all'), 'all')
  })

  it('resolveStartedAtFilter supports last30d', () => {
    const all = resolveStartedAtFilter('all')
    assert.equal(all.ok, true)
    if (all.ok) assert.equal(all.filter, undefined)

    const month = resolveStartedAtFilter('last30d')
    assert.equal(month.ok, true)
    if (month.ok) assert.ok(month.filter?.gte)
  })

  it('parseMatchListSort defaults and rejects junk', () => {
    assert.equal(parseMatchListSort(undefined), 'time_desc')
    assert.equal(parseMatchListSort('wager_asc'), 'wager_asc')
    assert.equal(parseMatchListSort('wager_desc'), 'wager_desc')
    assert.equal(parseMatchListSort('nope'), null)
  })

  it('resolveMatchListOrderBy maps sort keys', () => {
    assert.deepEqual(resolveMatchListOrderBy('time_desc'), [
      { match: { startedAt: 'desc' } }
    ])
    assert.deepEqual(resolveMatchListOrderBy('wager_desc'), [
      { wager: 'desc' },
      { match: { startedAt: 'desc' } }
    ])
    assert.deepEqual(resolveMatchListOrderBy('wager_asc'), [
      { wager: 'asc' },
      { match: { startedAt: 'desc' } }
    ])
  })
})
