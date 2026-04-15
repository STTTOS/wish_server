import type { Texas } from 'texas-poker-core'
import type { StartRoomInfo, MatchRollbackManager } from './types'

import test from 'node:test'
import assert from 'node:assert/strict'

import { GameRuntimeRegistry } from './runtimeRegistry'

const fakeRoomInfo = {
  id: 1,
  ownerId: 1,
  deletedAt: null,
  lowestBetAmount: 10,
  initialChips: 1000,
  thinkingTime: 30,
  owner: { id: 1, name: 'o' }
} satisfies StartRoomInfo

const noopRollbackManager: MatchRollbackManager = {
  snapshotPlayersAtHandStart: () => undefined,
  invalidateAndRollbackMatch: async () => Promise.resolve(),
  clearInvalidatedFlag: () => undefined,
  clearSnapshot: () => undefined
}

test('GameRuntimeRegistry destroyRuntime resets texas and removes runtime', () => {
  const registry = new GameRuntimeRegistry()
  let resetCalled = 0
  const fakeTexas = { reset: () => (resetCalled += 1) } as unknown as Texas

  registry.register({
    roomId: 1,
    roomKey: '1',
    roomInfo: fakeRoomInfo,
    texas: fakeTexas,
    currentMatchId: 100,
    matchStartedAt: Date.now(),
    rollbackManager: noopRollbackManager,
    pendingTexasSeatRemovalUserIds: new Set(),
    quitBlockedUntilBlindsPosted: false
  })

  assert.equal(registry.hasTexas('1'), true)
  registry.destroyRuntime('1')
  assert.equal(resetCalled, 1)
  assert.equal(registry.hasTexas('1'), false)
})

test('GameRuntimeRegistry current match read/write', () => {
  const registry = new GameRuntimeRegistry()
  const fakeTexas = {
    reset: () => undefined
  } as unknown as Texas

  registry.register({
    roomId: 2,
    roomKey: '2',
    roomInfo: fakeRoomInfo,
    texas: fakeTexas,
    currentMatchId: 200,
    matchStartedAt: Date.now(),
    rollbackManager: noopRollbackManager,
    pendingTexasSeatRemovalUserIds: new Set(),
    quitBlockedUntilBlindsPosted: false
  })

  assert.equal(registry.getCurrentMatchId('2'), 200)
  registry.setCurrentMatchId('2', 201)
  assert.equal(registry.getCurrentMatchId('2'), 201)
})
