import assert from 'node:assert/strict'
import { it, describe } from 'node:test'

import {
  matchesAnnouncementClientVersion,
  parseAnnouncementClientVersionRange,
  validateAnnouncementClientVersionRange
} from './announcementClientVersion'

describe('announcementClientVersion', () => {
  it('parse accepts empty as all versions', () => {
    const parsed = parseAnnouncementClientVersionRange(null, undefined)
    assert.equal(parsed.ok, true)
    if (!parsed.ok) return
    assert.equal(parsed.range.minClientVersion, null)
    assert.equal(parsed.range.maxClientVersion, null)
  })

  it('rejects invalid semver', () => {
    const parsed = parseAnnouncementClientVersionRange('abc', '1.0.2')
    assert.equal(parsed.ok, false)
  })

  it('rejects min greater than max', () => {
    const parsed = parseAnnouncementClientVersionRange('1.0.5', '1.0.2')
    assert.equal(parsed.ok, false)
    if (parsed.ok) return
    assert.match(parsed.error, /最低版本不能高于最高版本/)
  })

  it('matches closed interval', () => {
    const range = { minClientVersion: '1.0.1', maxClientVersion: '1.0.2' }
    assert.equal(validateAnnouncementClientVersionRange(range), null)
    assert.equal(matchesAnnouncementClientVersion(range, '1.0.0'), false)
    assert.equal(matchesAnnouncementClientVersion(range, '1.0.1'), true)
    assert.equal(matchesAnnouncementClientVersion(range, '1.0.2'), true)
    assert.equal(matchesAnnouncementClientVersion(range, '1.0.3'), false)
  })

  it('matches exact version when min equals max', () => {
    const range = { minClientVersion: '1.0.5', maxClientVersion: '1.0.5' }
    assert.equal(matchesAnnouncementClientVersion(range, '1.0.5'), true)
    assert.equal(matchesAnnouncementClientVersion(range, '1.0.4'), false)
  })
})
