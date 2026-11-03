import assert from 'node:assert/strict'
import { it, describe } from 'node:test'

import {
  resolveStartedAtFilter,
  resolveBoardStageFilter,
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

  it('resolveStartedAtFilter validates custom range', () => {
    const bad = resolveStartedAtFilter('range', '2026-02-01', '2026-01-01')
    assert.equal(bad.ok, false)
    const ok = resolveStartedAtFilter('range', '2026-01-01', '2026-01-31')
    assert.equal(ok.ok, true)
    if (ok.ok) {
      assert.ok(ok.filter?.gte)
      assert.ok(ok.filter?.lte)
    }
  })
})
