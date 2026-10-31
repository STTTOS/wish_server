import test from 'node:test'
import assert from 'node:assert/strict'

import { stageToStreet, roleToPositionBucket } from './position'

test('roleToPositionBucket maps core roles', () => {
  assert.equal(roleToPositionBucket('btn'), 'btn')
  assert.equal(roleToPositionBucket('co'), 'co')
  assert.equal(roleToPositionBucket('utg'), 'ep')
  assert.equal(roleToPositionBucket('hj'), 'mp')
  assert.equal(roleToPositionBucket('nope'), 'unknown')
})

test('stageToStreet', () => {
  assert.equal(stageToStreet('pre_flop'), 'preflop')
  assert.equal(stageToStreet('flop'), 'flop')
  assert.equal(stageToStreet('turn'), 'turn')
  assert.equal(stageToStreet('river'), 'river')
})
