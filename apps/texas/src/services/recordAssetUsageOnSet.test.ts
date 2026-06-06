import assert from 'node:assert/strict'
import { it, describe } from 'node:test'

import {
  ASSET_USAGE_SET_DEBOUNCE_MS,
  shouldRecordAssetUsageOnSet
} from './recordAssetUsageOnSet'

describe('shouldRecordAssetUsageOnSet', () => {
  const now = new Date('2026-06-06T12:00:00.000Z')

  it('skips when asset id unchanged', () => {
    assert.equal(
      shouldRecordAssetUsageOnSet({
        previousAssetId: 'card_back_a',
        nextAssetId: 'card_back_a',
        lastSameAssetEventAt: null,
        now
      }),
      false
    )
  })

  it('records first switch to a new asset', () => {
    assert.equal(
      shouldRecordAssetUsageOnSet({
        previousAssetId: 'default',
        nextAssetId: 'card_back_a',
        lastSameAssetEventAt: null,
        now
      }),
      true
    )
  })

  it('skips when same asset was recorded within debounce window', () => {
    const recent = new Date(now.getTime() - ASSET_USAGE_SET_DEBOUNCE_MS + 1_000)
    assert.equal(
      shouldRecordAssetUsageOnSet({
        previousAssetId: 'card_back_b',
        nextAssetId: 'card_back_a',
        lastSameAssetEventAt: recent,
        now
      }),
      false
    )
  })

  it('records when same asset was last recorded outside debounce window', () => {
    const old = new Date(now.getTime() - ASSET_USAGE_SET_DEBOUNCE_MS - 1)
    assert.equal(
      shouldRecordAssetUsageOnSet({
        previousAssetId: 'card_back_b',
        nextAssetId: 'card_back_a',
        lastSameAssetEventAt: old,
        now
      }),
      true
    )
  })
})
