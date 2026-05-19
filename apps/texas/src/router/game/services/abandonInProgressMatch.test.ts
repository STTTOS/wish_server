/* eslint-disable @typescript-eslint/no-explicit-any */
import test from 'node:test'
import assert from 'node:assert/strict'

import { gameRuntimeRegistry } from './runtimeRegistry'
import { abandonInProgressMatchOnTeardown } from './abandonInProgressMatch'
import {
  betRecord,
  roomChipTopUp,
  matchDomainEvent,
  playerMatchRecord,
  match as matchModel,
  matchStageTimeRecord
} from '../../../models'

test('abandonInProgressMatchOnTeardown purges match and clears currentMatchId', async () => {
  const runtimeAny = gameRuntimeRegistry as unknown as {
    getCurrentMatchId: (roomKey: string) => number | null
    getOrThrow: (roomKey: string) => { currentMatchId: number | null }
  }
  const matchAny = matchModel as unknown as {
    findUnique: (
      args: unknown
    ) => Promise<{ endedAt: Date | null; roomId: number } | null>
    delete: (args: unknown) => Promise<unknown>
  }
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

  const runtimeState = { currentMatchId: 9001 as number | null }
  let deletedMatchId: number | null = null

  const originGetCurrentMatchId = runtimeAny.getCurrentMatchId
  const originGetOrThrow = runtimeAny.getOrThrow
  const originFindUnique = matchAny.findUnique
  const originMatchDelete = matchAny.delete
  const originChipDelete = chipAny.deleteMany
  const originDomainDelete = domainAny.deleteMany
  const originStageDelete = stageAny.deleteMany
  const originBetDelete = betAny.deleteMany
  const originPlayerDelete = playerAny.deleteMany

  try {
    runtimeAny.getCurrentMatchId = () => runtimeState.currentMatchId
    runtimeAny.getOrThrow = () => runtimeState
    matchAny.findUnique = async () => ({ endedAt: null, roomId: 42 })
    chipAny.deleteMany = async () => ({ count: 0 })
    domainAny.deleteMany = async () => ({ count: 0 })
    stageAny.deleteMany = async () => ({ count: 0 })
    betAny.deleteMany = async () => ({ count: 0 })
    playerAny.deleteMany = async () => ({ count: 0 })
    matchAny.delete = async (args) => {
      deletedMatchId = (args as { where: { id: number } }).where.id
      return {}
    }

    await abandonInProgressMatchOnTeardown(42, '42')

    assert.equal(deletedMatchId, 9001)
    assert.equal(runtimeState.currentMatchId, null)
  } finally {
    runtimeAny.getCurrentMatchId = originGetCurrentMatchId
    runtimeAny.getOrThrow = originGetOrThrow
    matchAny.findUnique = originFindUnique
    matchAny.delete = originMatchDelete
    chipAny.deleteMany = originChipDelete
    domainAny.deleteMany = originDomainDelete
    stageAny.deleteMany = originStageDelete
    betAny.deleteMany = originBetDelete
    playerAny.deleteMany = originPlayerDelete
  }
})

test('abandonInProgressMatchOnTeardown skips ended match', async () => {
  const runtimeAny = gameRuntimeRegistry as unknown as {
    getCurrentMatchId: (roomKey: string) => number | null
  }
  const matchAny = matchModel as unknown as {
    findUnique: (
      args: unknown
    ) => Promise<{ endedAt: Date | null; roomId: number } | null>
    delete: (args: unknown) => Promise<unknown>
  }

  const originGetCurrentMatchId = runtimeAny.getCurrentMatchId
  const originFindUnique = matchAny.findUnique
  const originMatchDelete = matchAny.delete

  let deleteCalled = 0

  try {
    runtimeAny.getCurrentMatchId = () => 9002
    matchAny.findUnique = async () => ({
      endedAt: new Date(),
      roomId: 42
    })
    matchAny.delete = async () => {
      deleteCalled += 1
      return {}
    }

    await abandonInProgressMatchOnTeardown(42, '42')
    assert.equal(deleteCalled, 0)
  } finally {
    runtimeAny.getCurrentMatchId = originGetCurrentMatchId
    matchAny.findUnique = originFindUnique
    matchAny.delete = originMatchDelete
  }
})
