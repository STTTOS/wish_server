import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'

import { isGoldMarketOpen } from '../services/marketHours'
import {
  tradingDayBoundsMs,
  tradingDayKeyFromTs,
  tradingDayStartMs
} from './goldTradingDay'

type TradingDayCase = {
  name: string;
  tsIso: string;
  expectStartIso: string;
  expectKey: string;
};

type ChartTsCase = {
  name: string;
  dateKey: string;
  expectStartIso: string;
  expectEndExclIso?: string;
};

type MarketOpenCase = {
  name: string;
  tsIso: string;
  open: boolean;
};

type Fixtures = {
  tradingDay: TradingDayCase[];
  chartTs: ChartTsCase[];
  marketOpen: MarketOpenCase[];
};

const fixtures = JSON.parse(
  readFileSync(
    join(__dirname, '../fixtures/gold-calendar.fixtures.json'),
    'utf8'
  )
) as Fixtures

describe('goldTradingDay (shared fixtures)', () => {
  for (const c of fixtures.tradingDay) {
    it(c.name, () => {
      const ts = Date.parse(c.tsIso)
      assert.equal(tradingDayStartMs(ts), Date.parse(c.expectStartIso))
      assert.equal(tradingDayKeyFromTs(ts), c.expectKey)
    })
  }

  for (const c of fixtures.chartTs) {
    it(c.name, () => {
      const { from, toExcl } = tradingDayBoundsMs(c.dateKey)
      assert.equal(from, Date.parse(c.expectStartIso))
      if (c.expectEndExclIso) {
        assert.equal(toExcl, Date.parse(c.expectEndExclIso))
      }
    })
  }

  for (const c of fixtures.marketOpen) {
    it(`marketOpen: ${c.name}`, () => {
      assert.equal(isGoldMarketOpen(Date.parse(c.tsIso)), c.open)
    })
  }
})
