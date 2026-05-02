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
  isPrivate: false,
  owner: { id: 1, name: 'o' }
} satisfies StartRoomInfo

const noopRollbackManager: MatchRollbackManager = {
  invalidateAndRollbackMatch: async () => Promise.resolve(),
  clearInvalidatedFlag: () => undefined
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
    pendingLeaveByUserId: new Set(),
    pendingPostBigBlindUserIds: new Set(),
    offlineUserIds: new Set(),
    offlineHandCountByUserId: new Map(),
    autoTopUpEnabledByUserId: new Map(),
    rosterSeq: 0,
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
    pendingLeaveByUserId: new Set(),
    pendingPostBigBlindUserIds: new Set(),
    offlineUserIds: new Set(),
    offlineHandCountByUserId: new Map(),
    autoTopUpEnabledByUserId: new Map(),
    rosterSeq: 0,
    quitBlockedUntilBlindsPosted: false
  })

  assert.equal(registry.getCurrentMatchId('2'), 200)
  registry.setCurrentMatchId('2', 201)
  assert.equal(registry.getCurrentMatchId('2'), 201)
})

test('flushDeferredTexasSeatRemovals removes queued user ids', () => {
  const registry = new GameRuntimeRegistry()
  const seatedUserIds = new Set([1, 2])
  const fakeTexas = {
    reset: () => undefined,
    room: {
      has: (userId: number) => seatedUserIds.has(userId),
      removeById: (userId: number) => void seatedUserIds.delete(userId)
    }
  } as unknown as Texas

  registry.register({
    roomId: 3,
    roomKey: '3',
    roomInfo: fakeRoomInfo,
    texas: fakeTexas,
    currentMatchId: 300,
    matchStartedAt: Date.now(),
    rollbackManager: noopRollbackManager,
    pendingLeaveByUserId: new Set([2]),
    pendingPostBigBlindUserIds: new Set(),
    offlineUserIds: new Set(),
    offlineHandCountByUserId: new Map(),
    autoTopUpEnabledByUserId: new Map(),
    rosterSeq: 0,
    quitBlockedUntilBlindsPosted: false
  })

  const result = registry.flushDeferredTexasSeatRemovals('3', new Set())
  assert.deepEqual(result.removedFromRingUserIds, [2])
  assert.equal(seatedUserIds.has(2), false)
})

test('flushDeferredTexasSeatRemovals keeps ring seat when room member exists', () => {
  const registry = new GameRuntimeRegistry()
  const seatedUserIds = new Set([1, 2])
  const fakeTexas = {
    reset: () => undefined,
    room: {
      has: (userId: number) => seatedUserIds.has(userId),
      removeById: (userId: number) => void seatedUserIds.delete(userId)
    }
  } as unknown as Texas

  registry.register({
    roomId: 4,
    roomKey: '4',
    roomInfo: fakeRoomInfo,
    texas: fakeTexas,
    currentMatchId: 400,
    matchStartedAt: Date.now(),
    rollbackManager: noopRollbackManager,
    pendingLeaveByUserId: new Set([2]),
    pendingPostBigBlindUserIds: new Set(),
    offlineUserIds: new Set(),
    offlineHandCountByUserId: new Map(),
    autoTopUpEnabledByUserId: new Map(),
    rosterSeq: 0,
    quitBlockedUntilBlindsPosted: false
  })

  const result = registry.flushDeferredTexasSeatRemovals('4', new Set([2]))
  assert.deepEqual(result.removedFromRingUserIds, [])
  assert.equal(seatedUserIds.has(2), true)
  assert.equal(registry.getOrThrow('4').pendingLeaveByUserId.size, 0)
})
