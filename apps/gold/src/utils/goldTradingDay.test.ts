import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  tradingDayBoundsMs,
  tradingDayKeyFromTs,
  tradingDayStartMs
} from './goldTradingDay'

describe('goldTradingDay', () => {
  it('labels session before UTC 22:00 as closing on that calendar day', () => {
    const ts = Date.UTC(2026, 7, 22, 7, 51, 0)
    assert.equal(tradingDayStartMs(ts), Date.UTC(2026, 7, 21, 22, 0, 0, 0))
    assert.equal(tradingDayKeyFromTs(ts), '2026-08-22')
  })

  it('rolls to next trading day after UTC 22:00', () => {
    const ts = Date.UTC(2026, 7, 22, 23, 0, 0)
    assert.equal(tradingDayStartMs(ts), Date.UTC(2026, 7, 22, 22, 0, 0, 0))
    assert.equal(tradingDayKeyFromTs(ts), '2026-08-23')
  })

  it('bounds match session start/end', () => {
    const { from, toExcl } = tradingDayBoundsMs('2026-08-22')
    assert.equal(from, Date.UTC(2026, 7, 21, 22, 0, 0, 0))
    assert.equal(toExcl, Date.UTC(2026, 7, 22, 22, 0, 0, 0))
  })
})
