import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { buildDailyQualityNotes } from './dailyQuality'

const DAY_MS = 86_400_000

describe('buildDailyQualityNotes', () => {
  const base = {
    marketClosedDay: false,
    partialDay: false,
    tickCount: 100,
    coveragePct: 99,
    gapCount: 0,
    dailyBarFrozen: false,
    dailyBarSource: 'tick:gold-api' as string | null
  }

  it('does not label Tuesday partial day as 半日开市', () => {
    const notes = buildDailyQualityNotes({
      ...base,
      dateKey: '2026-08-25',
      partialDay: true,
      openMs: DAY_MS / 2
    })
    assert.ok(!notes.includes('半日开市'))
    assert.ok(notes.includes('进行中'))
  })

  it('labels Monday partial day (weekend reopen) as 半日开市', () => {
    const notes = buildDailyQualityNotes({
      ...base,
      dateKey: '2026-08-24',
      partialDay: true,
      openMs: 2 * 3_600_000
    })
    assert.ok(notes.includes('半日开市'))
    assert.ok(notes.includes('进行中'))
  })

  it('does not label completed Monday full session as 半日开市', () => {
    const notes = buildDailyQualityNotes({
      ...base,
      dateKey: '2026-08-24',
      partialDay: false,
      openMs: DAY_MS - 30_000,
      dailyBarFrozen: true
    })
    assert.ok(!notes.includes('半日开市'))
    assert.ok(notes.includes('已冻结'))
  })

  it('labels closed weekend days as 休市', () => {
    const notes = buildDailyQualityNotes({
      ...base,
      dateKey: '2026-08-23',
      marketClosedDay: true,
      openMs: 0,
      tickCount: 0,
      coveragePct: 100,
      dailyBarFrozen: true
    })
    assert.ok(notes.includes('休市'))
    assert.ok(!notes.includes('半日开市'))
  })
})
