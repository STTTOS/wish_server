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

test('tryCleanupWaitingRoomIfAllOffline does nothing when socketCount > 0', async () => {
  const manager = new RoomCleanupManager({
    getWaitingRoomSocketCount: () => 1,
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
