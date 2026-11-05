import assert from 'node:assert/strict'
import { it, describe } from 'node:test'

import {
  tierFromScore,
  isHeatedSharedHand,
  computeCoplayIntensity,
  COPLAY_INTENSITY_MIN_HANDS
} from './coplayIntensity'

describe('isHeatedSharedHand', () => {
  it('requires both-in and pot depth', () => {
    assert.equal(
      isHeatedSharedHand({
        lowestBetAmount: 200,
        matchTotalBetAmount: 200 * 20,
        myTotalBetAmount: 400,
        peerTotalBetAmount: 400
      }),
      true
    )
    assert.equal(
      isHeatedSharedHand({
        lowestBetAmount: 200,
        matchTotalBetAmount: 200 * 20,
        myTotalBetAmount: 0,
        peerTotalBetAmount: 400
      }),
      false
    )
    assert.equal(
      isHeatedSharedHand({
        lowestBetAmount: 200,
        matchTotalBetAmount: 200 * 5,
        myTotalBetAmount: 400,
        peerTotalBetAmount: 400
      }),
      false
    )
  })
})

describe('computeCoplayIntensity', () => {
  const now = Date.UTC(2026, 10, 5)

  it('returns null when sample is thin', () => {
    assert.equal(
      computeCoplayIntensity({
        playCount: COPLAY_INTENSITY_MIN_HANDS - 1,
        heatedHandCount: 2,
        lastPlayedTs: now,
        nowTs: now
      }),
      null
    )
  })

  it('scores high for dense heated recent play', () => {
    const r = computeCoplayIntensity({
      playCount: 30,
      heatedHandCount: 30,
      lastPlayedTs: now,
      nowTs: now
    })
    assert.ok(r)
    assert.equal(r!.score, 100)
    assert.equal(r!.tier, 'blazing')
  })

  it('maps tiers by score', () => {
    assert.equal(tierFromScore(10), 'cold')
    assert.equal(tierFromScore(25), 'warm')
    assert.equal(tierFromScore(50), 'hot')
    assert.equal(tierFromScore(75), 'blazing')
  })
})
