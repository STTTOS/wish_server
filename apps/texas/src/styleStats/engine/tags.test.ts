import test from 'node:test'
import assert from 'node:assert/strict'

import { deriveStyleTags, derivePlayStyleArchetype } from './tags'

test('deriveStyleTags: insufficient sample only', () => {
  const tags = deriveStyleTags({
    hands: 10,
    sampleStatus: 'insufficient',
    vpip: 90,
    pfr: 40,
    wtsd: 40,
    wsd: 40,
    discipline: 20,
    popAvgDiscipline: 50,
    limpHands: 5
  })
  assert.equal(tags.length, 1)
  assert.equal(tags[0]?.key, 'sample_insufficient')
  assert.equal(
    derivePlayStyleArchetype({
      hands: 10,
      sampleStatus: 'insufficient',
      vpip: 90,
      pfr: 40
    }),
    null
  )
})

test('derivePlayStyleArchetype: loose passive; tags are leaks only', () => {
  const input = {
    hands: 500,
    sampleStatus: 'ok' as const,
    vpip: 90.6,
    pfr: 46.7,
    wtsd: 39.3,
    wsd: 41.1,
    discipline: 24,
    popAvgDiscipline: 50,
    limpHands: 120
  }
  const arch = derivePlayStyleArchetype(input)
  assert.equal(arch?.key, 'style_fish')
  assert.equal(arch?.label, '松被动')

  const tags = deriveStyleTags(input)
  const keys = tags.map((t) => t.key)
  assert.ok(!keys.includes('style_fish'))
  assert.ok(!keys.some((k) => k.startsWith('style_')))
  assert.ok(keys.includes('leak_calling_station'))
  assert.ok(keys.includes('leak_vpip_high'))
  assert.ok(keys.includes('leak_limp'))
  assert.ok(keys.includes('leak_discipline_low'))
})

test('derivePlayStyleArchetype: tight aggressive', () => {
  const arch = derivePlayStyleArchetype({
    hands: 200,
    sampleStatus: 'ok',
    vpip: 22,
    pfr: 18
  })
  assert.equal(arch?.key, 'style_tight_aggro')
  assert.equal(arch?.label, '紧凶')

  const tags = deriveStyleTags({
    hands: 200,
    sampleStatus: 'ok',
    vpip: 22,
    pfr: 18,
    wtsd: 25,
    wsd: 55,
    discipline: 62,
    popAvgDiscipline: 50,
    limpHands: 5
  })
  assert.ok(!tags.some((t) => t.tone === 'leak'))
  assert.ok(!tags.some((t) => t.tone === 'style'))
})

test('deriveStyleTags: vpip leak is absolute not vs pop', () => {
  const tags = deriveStyleTags({
    hands: 6000,
    sampleStatus: 'ok',
    vpip: 60.3,
    pfr: 6.3,
    wtsd: 24,
    wsd: 56,
    discipline: 50,
    popAvgDiscipline: 50,
    limpHands: 2000
  })
  assert.ok(tags.some((t) => t.key === 'leak_vpip_high'))
  assert.equal(
    derivePlayStyleArchetype({
      hands: 6000,
      sampleStatus: 'ok',
      vpip: 60.3,
      pfr: 6.3
    })?.key,
    'style_fish'
  )
})

test('derivePlayStyleArchetype: loose + ratio 0.52 is 松被动 not 常规', () => {
  const arch = derivePlayStyleArchetype({
    hands: 500,
    sampleStatus: 'ok',
    vpip: 90.6,
    pfr: 46.7
  })
  assert.equal(arch?.key, 'style_fish')
  assert.notEqual(arch?.key, 'style_reg')
})

test('derivePlayStyleArchetype: mid band is 常规', () => {
  const arch = derivePlayStyleArchetype({
    hands: 200,
    sampleStatus: 'ok',
    vpip: 32,
    pfr: 20
  })
  assert.equal(arch?.key, 'style_reg')
})
