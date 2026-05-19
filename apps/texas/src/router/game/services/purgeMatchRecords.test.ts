/* eslint-disable @typescript-eslint/no-explicit-any */
import test from 'node:test'
import assert from 'node:assert/strict'

import { purgeMatchRecords } from './purgeMatchRecords'
import {
  betRecord,
  roomChipTopUp,
  matchDomainEvent,
  playerMatchRecord,
  match as matchModel,
  matchStageTimeRecord
} from '../../../models'

test('purgeMatchRecords deletes match tree in dependency order', async () => {
  const order: string[] = []
  const chipAny = roomChipTopUp as unknown as {
    deleteMany: (args: unknown) => Promise<{ count: number }>
  }
  const domainAny = matchDomainEvent as unknown as {
    deleteMany: (args: unknown) => Promise<{ count: number }>
  }
  const stageAny = matchStageTimeRecord as unknown as {
    deleteMany: (args: unknown) => Promise<{ count: number }>
  }
  const betAny = betRecord as unknown as {
    deleteMany: (args: unknown) => Promise<{ count: number }>
  }
  const playerAny = playerMatchRecord as unknown as {
    deleteMany: (args: unknown) => Promise<{ count: number }>
  }
  const matchAny = matchModel as unknown as {
    delete: (args: unknown) => Promise<unknown>
  }

  const originChip = chipAny.deleteMany
  const originDomain = domainAny.deleteMany
  const originStage = stageAny.deleteMany
  const originBet = betAny.deleteMany
  const originPlayer = playerAny.deleteMany
  const originMatchDelete = matchAny.delete

  try {
    chipAny.deleteMany = async () => {
      order.push('chip')
      return { count: 0 }
    }
    domainAny.deleteMany = async () => {
      order.push('domain')
      return { count: 0 }
    }
    stageAny.deleteMany = async () => {
      order.push('stage')
      return { count: 0 }
    }
    betAny.deleteMany = async () => {
      order.push('bet')
      return { count: 0 }
    }
    playerAny.deleteMany = async () => {
      order.push('player')
      return { count: 0 }
    }
    matchAny.delete = async () => {
      order.push('match')
      return {}
    }

    await purgeMatchRecords(42)

    assert.deepEqual(order, [
      'chip',
      'domain',
      'stage',
      'bet',
      'player',
      'match'
    ])
  } finally {
    chipAny.deleteMany = originChip
    domainAny.deleteMany = originDomain
    stageAny.deleteMany = originStage
    betAny.deleteMany = originBet
    playerAny.deleteMany = originPlayer
    matchAny.delete = originMatchDelete
  }
})
