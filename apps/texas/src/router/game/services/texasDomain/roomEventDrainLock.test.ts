import test from 'node:test'
import assert from 'node:assert/strict'

import {
  withRoomEventDrainLock,
  clearRoomEventDrainLock
} from './roomEventDrainLock'

test('withRoomEventDrainLock serializes concurrent drains for same room', async () => {
  const order: number[] = []
  const roomKey = 'room-serialize'

  const first = withRoomEventDrainLock(roomKey, async () => {
    order.push(1)
    await new Promise((r) => setTimeout(r, 30))
    order.push(2)
  })
  const second = withRoomEventDrainLock(roomKey, async () => {
    order.push(3)
  })

  await Promise.all([first, second])
  assert.deepEqual(order, [1, 2, 3])
})

test('clearRoomEventDrainLock drops queued tail for room', async () => {
  const roomKey = 'room-clear'
  let ran = false
  clearRoomEventDrainLock(roomKey)
  await withRoomEventDrainLock(roomKey, async () => {
    ran = true
  })
  assert.equal(ran, true)
  clearRoomEventDrainLock(roomKey)
})
