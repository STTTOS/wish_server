import test from 'node:test'
import assert from 'node:assert/strict'

import { deriveStyleTags } from './tags'

test('deriveStyleTags: insufficient sample only', () => {
  const tags = deriveStyleTags({
    hands: 10,
    sampleStatus: 'insufficient',
    vpip: 90,
    pfr: 40,
    wtsd: 40,
    wsd: 40,
    skill: 20,
    popAvgSkill: 50,
    limpHands: 5
  })
  assert.equal(tags.length, 1)
  assert.equal(tags[0]?.key, 'sample_insufficient')
})

test('deriveStyleTags: loose passive fish with leaks', () => {
  const tags = deriveStyleTags({
    hands: 500,
    sampleStatus: 'ok',
    vpip: 90.6,
    pfr: 46.7,
    wtsd: 39.3,
    wsd: 41.1,
    skill: 24,
    popAvgSkill: 50,
    limpHands: 120
  })
  const keys = tags.map((t) => t.key)
  assert.ok(!keys.includes('sample_ok'))
  assert.ok(keys.includes('style_fish'))
  assert.ok(keys.includes('leak_calling_station'))
  assert.ok(keys.includes('leak_vpip_high'))
  assert.ok(keys.includes('leak_limp'))
  assert.ok(!keys.includes('leak_chart'))
  assert.ok(keys.includes('leak_skill_low'))
})

test('deriveStyleTags: tight aggressive', () => {
  const tags = deriveStyleTags({
    hands: 200,
    sampleStatus: 'ok',
    vpip: 22,
    pfr: 18,
    wtsd: 25,
    wsd: 55,
    skill: 62,
    popAvgSkill: 50,
    limpHands: 5
  })
  assert.ok(tags.some((t) => t.key === 'style_tight_aggro'))
  assert.ok(!tags.some((t) => t.key === 'sample_ok'))
  assert.ok(!tags.some((t) => t.tone === 'leak'))
})

test('deriveStyleTags: vpip leak is absolute not vs pop', () => {
  const tags = deriveStyleTags({
    hands: 6000,
    sampleStatus: 'ok',
    vpip: 60.3,
    pfr: 6.3,
    wtsd: 24,
    wsd: 56,
    skill: 50,
    popAvgSkill: 50,
    limpHands: 2000
  })
  assert.ok(tags.some((t) => t.key === 'leak_vpip_high'))
  assert.ok(tags.some((t) => t.key === 'style_fish'))
})

test('deriveStyleTags: loose + ratio 0.52 is 松被动 not 常规', () => {
  const tags = deriveStyleTags({
    hands: 500,
    sampleStatus: 'ok',
    vpip: 90.6,
    pfr: 46.7,
    wtsd: 25,
    wsd: 50,
    skill: 40,
    popAvgSkill: 40,
    limpHands: 10
  })
  assert.ok(tags.some((t) => t.key === 'style_fish'))
  assert.ok(!tags.some((t) => t.key === 'style_reg'))
})
