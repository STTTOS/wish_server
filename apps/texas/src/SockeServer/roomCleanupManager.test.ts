/* eslint-disable @typescript-eslint/no-explicit-any */
import test from 'node:test'
import assert from 'node:assert/strict'

import prisma, { room as roomModel } from '../models'
import { RoomCleanupManager } from './roomCleanupManager'
import { gameRuntimeRegistry } from '../router/game/services/runtimeRegistry'

test('tryCleanupWaitingRoomIfAllOffline soft deletes room when all waiting-room sockets offline', async () => {
  let deletedNotified: number | null = null
  const manager = new RoomCleanupManager({
    getWaitingRoomSocketCount: () => 0,
    getGameRoomSocketCount: () => 0,
    onWaitingRoomDeleted: (roomId) => {
      deletedNotified = roomId
    }
  })

  const roomModelAny = roomModel as unknown as {
    findUnique: (args: unknown) => Promise<{
      deletedAt: Date | null
      gameStatus: 'waiting'
    } | null>
  }
  const prismaAny = prisma as unknown as {
    $transaction: (cb: (tx: any) => Promise<void>) => Promise<void>
  }
  const runtimeAny = gameRuntimeRegistry as unknown as {
    hasTexas: (roomId: string) => boolean
  }

  const originFindUnique = roomModelAny.findUnique
  const originTransaction = prismaAny.$transaction
  const originHasTexas = runtimeAny.hasTexas

  let updateCalled = 0
  let deleteMembersCalled = 0
  try {
    roomModelAny.findUnique = async () => ({
      deletedAt: null,
      gameStatus: 'waiting'
    })
    prismaAny.$transaction = async (cb) => {
      await cb({
        room: {
          update: async () => {
            updateCalled += 1
            return {}
          }
        },
        roomMember: {
          deleteMany: async () => {
            deleteMembersCalled += 1
            return { count: 1 }
          }
        }
      })
    }
    runtimeAny.hasTexas = () => false

    await manager.tryCleanupWaitingRoomIfAllOffline('100')
    assert.equal(updateCalled, 1)
    assert.equal(deleteMembersCalled, 1)
    assert.equal(deletedNotified, 100)
  } finally {
    roomModelAny.findUnique = originFindUnique
    prismaAny.$transaction = originTransaction
    runtimeAny.hasTexas = originHasTexas
  }
})

test('scheduleTryCleanupWaitingRoomIfAllOffline does not soft-delete before delay', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let deletedNotified: number | null = null
  const manager = new RoomCleanupManager({
    getWaitingRoomSocketCount: () => 0,
    getGameRoomSocketCount: () => 0,
    onWaitingRoomDeleted: (roomId) => {
      deletedNotified = roomId
    },
    waitingRoomEmptyCleanupDelayMs: 1000
  })

  const roomModelAny = roomModel as unknown as {
    findUnique: (args: unknown) => Promise<{
      deletedAt: Date | null
      gameStatus: 'waiting'
    } | null>
  }
  const prismaAny = prisma as unknown as {
    $transaction: (cb: (tx: any) => Promise<void>) => Promise<void>
  }
  const runtimeAny = gameRuntimeRegistry as unknown as {
    hasTexas: (roomId: string) => boolean
  }

  const originFindUnique = roomModelAny.findUnique
  const originTransaction = prismaAny.$transaction
  const originHasTexas = runtimeAny.hasTexas

  let updateCalled = 0
  const flushAsync = () =>
    new Promise<void>((resolve) => {
      setImmediate(resolve)
    })
  try {
    roomModelAny.findUnique = async () => ({
      deletedAt: null,
      gameStatus: 'waiting'
    })
    prismaAny.$transaction = async (cb) => {
      await cb({
        room: {
          update: async () => {
            updateCalled += 1
            return {}
          }
        },
        roomMember: { deleteMany: async () => ({ count: 0 }) }
      })
    }
    runtimeAny.hasTexas = () => false

    manager.scheduleTryCleanupWaitingRoomIfAllOffline('102')
    t.mock.timers.tick(500)
    await flushAsync()
    assert.equal(deletedNotified, null)
    assert.equal(updateCalled, 0)

    t.mock.timers.tick(600)
    await flushAsync()
    assert.equal(deletedNotified, 102)
  } finally {
    roomModelAny.findUnique = originFindUnique
    prismaAny.$transaction = originTransaction
    runtimeAny.hasTexas = originHasTexas
    t.mock.timers.reset()
  }
})

test('cancelScheduledWaitingRoomCleanup prevents delayed soft-delete', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let deletedNotified: number | null = null
  const manager = new RoomCleanupManager({
    getWaitingRoomSocketCount: () => 0,
    getGameRoomSocketCount: () => 0,
    onWaitingRoomDeleted: (roomId) => {
      deletedNotified = roomId
    },
    waitingRoomEmptyCleanupDelayMs: 1000
  })

  const roomModelAny = roomModel as unknown as {
    findUnique: (args: unknown) => Promise<{
      deletedAt: Date | null
      gameStatus: 'waiting'
    } | null>
  }
  const originFindUnique = roomModelAny.findUnique
  try {
    roomModelAny.findUnique = async () => ({
      deletedAt: null,
      gameStatus: 'waiting'
    })

    manager.scheduleTryCleanupWaitingRoomIfAllOffline('103')
    manager.cancelScheduledWaitingRoomCleanup('103')
    t.mock.timers.tick(2000)
    await new Promise<void>((resolve) => {
      setImmediate(resolve)
    })
    assert.equal(deletedNotified, null)
  } finally {
    roomModelAny.findUnique = originFindUnique
    t.mock.timers.reset()
  }
})

test('scheduleTryCleanupWaitingRoomIfAllOffline cancels timer when socket reconnects', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let deletedNotified: number | null = null
  let socketCount = 0
  const manager = new RoomCleanupManager({
    getWaitingRoomSocketCount: () => socketCount,
    getGameRoomSocketCount: () => 0,
    onWaitingRoomDeleted: (roomId) => {
      deletedNotified = roomId
    },
    waitingRoomEmptyCleanupDelayMs: 1000
  })

  const roomModelAny = roomModel as unknown as {
    findUnique: (args: unknown) => Promise<{
      deletedAt: Date | null
      gameStatus: 'waiting'
    } | null>
  }
  const originFindUnique = roomModelAny.findUnique
  try {
    roomModelAny.findUnique = async () => ({
      deletedAt: null,
      gameStatus: 'waiting'
    })

    manager.scheduleTryCleanupWaitingRoomIfAllOffline('104')
    socketCount = 1
    manager.scheduleTryCleanupWaitingRoomIfAllOffline('104')
    t.mock.timers.tick(2000)
    await new Promise<void>((resolve) => {
      setImmediate(resolve)
    })
    assert.equal(deletedNotified, null)
  } finally {
    roomModelAny.findUnique = originFindUnique
    t.mock.timers.reset()
  }
})

test('scheduleTryCleanupGameRoomIfAllOffline tears down after delay when no game sockets', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let destroyCalled = 0
  const manager = new RoomCleanupManager({
    getWaitingRoomSocketCount: () => 0,
    getGameRoomSocketCount: () => 0,
    onWaitingRoomDeleted: () => void 0,
    gameRoomAllOfflineTeardownDelayMs: 1000
  })

  const runtimeAny = gameRuntimeRegistry as unknown as {
    getTexas: (roomId: string) => { room: { getAllPlayers: () => unknown[] } }
    areAllTrackedPlayersOffline: (roomId: string) => boolean
    destroyRuntime: (roomId: string) => void
    hasTexas: (roomId: string) => boolean
    get: (roomId: string) => { currentMatchId: number | null; texas?: unknown }
  }
  const roomModelAny = roomModel as unknown as {
    update: (args: unknown) => Promise<unknown>
  }
  const originGetTexas = runtimeAny.getTexas
  const originAllOffline = runtimeAny.areAllTrackedPlayersOffline
  const originDestroy = runtimeAny.destroyRuntime
  const originHasTexas = runtimeAny.hasTexas
  const originRoomUpdate = roomModelAny.update

  try {
    runtimeAny.getTexas = () => ({
      room: { getAllPlayers: () => [{ id: 1 }] }
    })
    runtimeAny.areAllTrackedPlayersOffline = () => true
    runtimeAny.destroyRuntime = () => {
      destroyCalled += 1
    }
    runtimeAny.hasTexas = () => true
    roomModelAny.update = async () => ({})

    manager.scheduleTryCleanupGameRoomIfAllOffline('200')
    t.mock.timers.tick(500)
    assert.equal(destroyCalled, 0)
    t.mock.timers.tick(600)
    await new Promise<void>((resolve) => {
      setImmediate(resolve)
    })
    assert.equal(destroyCalled, 1)
  } finally {
    runtimeAny.getTexas = originGetTexas
    runtimeAny.areAllTrackedPlayersOffline = originAllOffline
    runtimeAny.destroyRuntime = originDestroy
    runtimeAny.hasTexas = originHasTexas
    roomModelAny.update = originRoomUpdate
    t.mock.timers.reset()
  }
})

test('scheduleTryCleanupGameRoomIfAllOffline does not schedule when game sockets remain', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let destroyCalled = 0
  const manager = new RoomCleanupManager({
    getWaitingRoomSocketCount: () => 0,
    getGameRoomSocketCount: () => 1,
    onWaitingRoomDeleted: () => void 0,
    gameRoomAllOfflineTeardownDelayMs: 1000
  })

  const runtimeAny = gameRuntimeRegistry as unknown as {
    getTexas: (roomId: string) => { room: { getAllPlayers: () => unknown[] } }
    destroyRuntime: (roomId: string) => void
  }
  const originGetTexas = runtimeAny.getTexas
  const originDestroy = runtimeAny.destroyRuntime

  try {
    runtimeAny.getTexas = () => ({
      room: { getAllPlayers: () => [{ id: 1 }] }
    })
    runtimeAny.destroyRuntime = () => {
      destroyCalled += 1
    }

    manager.scheduleTryCleanupGameRoomIfAllOffline('202')
    t.mock.timers.tick(2000)
    await new Promise<void>((resolve) => {
      setImmediate(resolve)
    })
    assert.equal(destroyCalled, 0)
  } finally {
    runtimeAny.getTexas = originGetTexas
    runtimeAny.destroyRuntime = originDestroy
    t.mock.timers.reset()
  }
})

test('cancelScheduledGameRoomCleanup prevents delayed runtime teardown', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let destroyCalled = 0
  const manager = new RoomCleanupManager({
    getWaitingRoomSocketCount: () => 0,
    getGameRoomSocketCount: () => 0,
    onWaitingRoomDeleted: () => void 0,
    gameRoomAllOfflineTeardownDelayMs: 1000
  })

  const runtimeAny = gameRuntimeRegistry as unknown as {
    getTexas: (roomId: string) => { room: { getAllPlayers: () => unknown[] } }
    areAllTrackedPlayersOffline: (roomId: string) => boolean
    destroyRuntime: (roomId: string) => void
  }
  const originGetTexas = runtimeAny.getTexas
  const originAllOffline = runtimeAny.areAllTrackedPlayersOffline
  const originDestroy = runtimeAny.destroyRuntime

  try {
    runtimeAny.getTexas = () => ({
      room: { getAllPlayers: () => [{ id: 1 }] }
    })
    runtimeAny.areAllTrackedPlayersOffline = () => true
    runtimeAny.destroyRuntime = () => {
      destroyCalled += 1
    }

    manager.scheduleTryCleanupGameRoomIfAllOffline('201')
    manager.cancelScheduledGameRoomCleanup('201')
    t.mock.timers.tick(2000)
    await new Promise<void>((resolve) => {
      setImmediate(resolve)
    })
    assert.equal(destroyCalled, 0)
  } finally {
    runtimeAny.getTexas = originGetTexas
    runtimeAny.areAllTrackedPlayersOffline = originAllOffline
    runtimeAny.destroyRuntime = originDestroy
    t.mock.timers.reset()
  }
})

test('tryCleanupWaitingRoomIfAllOffline does nothing when socketCount > 0', async () => {
  const manager = new RoomCleanupManager({
    getWaitingRoomSocketCount: () => 1,
    getGameRoomSocketCount: () => 0,
    onWaitingRoomDeleted: () => void 0
  })

  const roomModelAny = roomModel as unknown as {
    findUnique: (args: unknown) => Promise<{
      deletedAt: Date | null
      gameStatus: 'waiting'
    } | null>
  }
  const prismaAny = prisma as unknown as {
    $transaction: (cb: (tx: any) => Promise<void>) => Promise<void>
  }
  const runtimeAny = gameRuntimeRegistry as unknown as {
    hasTexas: (roomId: string) => boolean
  }

  const originFindUnique = roomModelAny.findUnique
  const originTransaction = prismaAny.$transaction
  const originHasTexas = runtimeAny.hasTexas

  let updateCalled = 0
  try {
    roomModelAny.findUnique = async () => ({
      deletedAt: null,
      gameStatus: 'waiting'
    })
    prismaAny.$transaction = async (cb) => {
      await cb({
        room: {
          update: async () => {
            updateCalled += 1
            return {}
          }
        },
        roomMember: {
          deleteMany: async () => ({ count: 0 })
        }
      })
    }
    runtimeAny.hasTexas = () => false

    await manager.tryCleanupWaitingRoomIfAllOffline('101')
    assert.equal(updateCalled, 0)
  } finally {
    roomModelAny.findUnique = originFindUnique
    prismaAny.$transaction = originTransaction
    runtimeAny.hasTexas = originHasTexas
  }
})

test('tryCleanupRoomIfAllOffline does nothing when game sockets remain', async () => {
  let destroyCalled = 0
  const manager = new RoomCleanupManager({
    getWaitingRoomSocketCount: () => 0,
    getGameRoomSocketCount: () => 1,
    onWaitingRoomDeleted: () => void 0
  })

  const runtimeAny = gameRuntimeRegistry as unknown as {
    getTexas: (roomId: string) => { room: { getAllPlayers: () => unknown[] } }
    destroyRuntime: (roomId: string) => void
  }
  const originGetTexas = runtimeAny.getTexas
  const originDestroy = runtimeAny.destroyRuntime

  try {
    runtimeAny.getTexas = () => ({
      room: { getAllPlayers: () => [{ id: 1 }] }
    })
    runtimeAny.destroyRuntime = () => {
      destroyCalled += 1
    }

    await manager.tryCleanupRoomIfAllOffline('302')
    assert.equal(destroyCalled, 0)
  } finally {
    runtimeAny.getTexas = originGetTexas
    runtimeAny.destroyRuntime = originDestroy
  }
})

test('tryCleanupRoomIfAllOffline tears down when no game sockets even if tracked players not all offline', async () => {
  let destroyCalled = 0
  const manager = new RoomCleanupManager({
    getWaitingRoomSocketCount: () => 0,
    getGameRoomSocketCount: () => 0,
    onWaitingRoomDeleted: () => void 0
  })

  const runtimeAny = gameRuntimeRegistry as unknown as {
    getTexas: (roomId: string) => { room: { getAllPlayers: () => unknown[] } }
    areAllTrackedPlayersOffline: (roomId: string) => boolean
    destroyRuntime: (roomId: string) => void
    getCurrentMatchId: (roomId: string) => number | null
  }
  const roomModelAny = roomModel as unknown as {
    update: (args: unknown) => Promise<unknown>
  }
  const originGetTexas = runtimeAny.getTexas
  const originAllOffline = runtimeAny.areAllTrackedPlayersOffline
  const originDestroy = runtimeAny.destroyRuntime
  const originGetCurrentMatchId = runtimeAny.getCurrentMatchId
  const originRoomUpdate = roomModelAny.update

  try {
    runtimeAny.getTexas = () => ({
      room: { getAllPlayers: () => [{ id: 1 }, { id: 2 }] }
    })
    runtimeAny.areAllTrackedPlayersOffline = () => false
    runtimeAny.getCurrentMatchId = () => null
    runtimeAny.destroyRuntime = () => {
      destroyCalled += 1
    }
    roomModelAny.update = async () => ({})

    await manager.tryCleanupRoomIfAllOffline('300')
    assert.equal(destroyCalled, 1)
  } finally {
    runtimeAny.getTexas = originGetTexas
    runtimeAny.areAllTrackedPlayersOffline = originAllOffline
    runtimeAny.destroyRuntime = originDestroy
    runtimeAny.getCurrentMatchId = originGetCurrentMatchId
    roomModelAny.update = originRoomUpdate
  }
})

test('tryCleanupRoomIfAllOffline soft-deletes room immediately after game teardown when waiting-room empty', async () => {
  let deletedNotified: number | null = null
  const manager = new RoomCleanupManager({
    getWaitingRoomSocketCount: () => 0,
    getGameRoomSocketCount: () => 0,
    onWaitingRoomDeleted: (roomId) => {
      deletedNotified = roomId
    }
  })

  const runtimeAny = gameRuntimeRegistry as unknown as {
    getTexas: (roomId: string) => { room: { getAllPlayers: () => unknown[] } }
    areAllTrackedPlayersOffline: (roomId: string) => boolean
    destroyRuntime: (roomId: string) => void
    hasTexas: (roomId: string) => boolean
    getCurrentMatchId: (roomId: string) => number | null
  }
  const roomModelAny = roomModel as unknown as {
    findUnique: (args: unknown) => Promise<{
      deletedAt: Date | null
      gameStatus: 'waiting'
    } | null>
    update: (args: unknown) => Promise<unknown>
  }
  const prismaAny = prisma as unknown as {
    $transaction: (cb: (tx: any) => Promise<void>) => Promise<void>
  }

  const originGetTexas = runtimeAny.getTexas
  const originAllOffline = runtimeAny.areAllTrackedPlayersOffline
  const originDestroy = runtimeAny.destroyRuntime
  const originHasTexas = runtimeAny.hasTexas
  const originGetCurrentMatchId = runtimeAny.getCurrentMatchId
  const originFindUnique = roomModelAny.findUnique
  const originRoomUpdate = roomModelAny.update
  const originTransaction = prismaAny.$transaction

  let updateCalled = 0
  try {
    runtimeAny.getTexas = () => ({
      room: { getAllPlayers: () => [{ id: 1 }, { id: 2 }] }
    })
    runtimeAny.areAllTrackedPlayersOffline = () => true
    runtimeAny.getCurrentMatchId = () => null
    runtimeAny.destroyRuntime = () => {
      runtimeAny.hasTexas = () => false
    }
    runtimeAny.hasTexas = () => true
    roomModelAny.update = async () => {
      updateCalled += 1
      return {}
    }
    roomModelAny.findUnique = async () => ({
      deletedAt: null,
      gameStatus: 'waiting'
    })
    prismaAny.$transaction = async (cb) => {
      await cb({
        room: { update: async () => ({}) },
        roomMember: { deleteMany: async () => ({ count: 2 }) }
      })
    }

    await manager.tryCleanupRoomIfAllOffline('400')
    assert.equal(updateCalled, 1)
    assert.equal(deletedNotified, 400)
  } finally {
    runtimeAny.getTexas = originGetTexas
    runtimeAny.areAllTrackedPlayersOffline = originAllOffline
    runtimeAny.destroyRuntime = originDestroy
    runtimeAny.hasTexas = originHasTexas
    runtimeAny.getCurrentMatchId = originGetCurrentMatchId
    roomModelAny.findUnique = originFindUnique
    roomModelAny.update = originRoomUpdate
    prismaAny.$transaction = originTransaction
  }
})

test('tryCleanupRoomIfAllOffline soft-deletes room when not all offlineUserIds but game teardown ran', async () => {
  let deletedNotified: number | null = null
  const manager = new RoomCleanupManager({
    getWaitingRoomSocketCount: () => 0,
    getGameRoomSocketCount: () => 0,
    onWaitingRoomDeleted: (roomId) => {
      deletedNotified = roomId
    }
  })

  const runtimeAny = gameRuntimeRegistry as unknown as {
    getTexas: (roomId: string) => { room: { getAllPlayers: () => unknown[] } }
    areAllTrackedPlayersOffline: (roomId: string) => boolean
    destroyRuntime: (roomId: string) => void
    hasTexas: (roomId: string) => boolean
    getCurrentMatchId: (roomId: string) => number | null
  }
  const roomModelAny = roomModel as unknown as {
    findUnique: (args: unknown) => Promise<{
      deletedAt: Date | null
      gameStatus: 'waiting'
    } | null>
    update: (args: unknown) => Promise<unknown>
  }
  const prismaAny = prisma as unknown as {
    $transaction: (cb: (tx: any) => Promise<void>) => Promise<void>
  }

  const originGetTexas = runtimeAny.getTexas
  const originAllOffline = runtimeAny.areAllTrackedPlayersOffline
  const originDestroy = runtimeAny.destroyRuntime
  const originHasTexas = runtimeAny.hasTexas
  const originGetCurrentMatchId = runtimeAny.getCurrentMatchId
  const originFindUnique = roomModelAny.findUnique
  const originRoomUpdate = roomModelAny.update
  const originTransaction = prismaAny.$transaction

  try {
    runtimeAny.getTexas = () => ({
      room: { getAllPlayers: () => [{ id: 1 }, { id: 2 }] }
    })
    runtimeAny.areAllTrackedPlayersOffline = () => false
    runtimeAny.getCurrentMatchId = () => null
    runtimeAny.destroyRuntime = () => {
      runtimeAny.hasTexas = () => false
    }
    runtimeAny.hasTexas = () => true
    roomModelAny.update = async () => ({})
    roomModelAny.findUnique = async () => ({
      deletedAt: null,
      gameStatus: 'waiting'
    })
    prismaAny.$transaction = async (cb) => {
      await cb({
        room: { update: async () => ({}) },
        roomMember: { deleteMany: async () => ({ count: 2 }) }
      })
    }

    await manager.tryCleanupRoomIfAllOffline('401')
    assert.equal(deletedNotified, 401)
  } finally {
    runtimeAny.getTexas = originGetTexas
    runtimeAny.areAllTrackedPlayersOffline = originAllOffline
    runtimeAny.destroyRuntime = originDestroy
    runtimeAny.hasTexas = originHasTexas
    runtimeAny.getCurrentMatchId = originGetCurrentMatchId
    roomModelAny.findUnique = originFindUnique
    roomModelAny.update = originRoomUpdate
    prismaAny.$transaction = originTransaction
  }
})
