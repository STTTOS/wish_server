import test from 'node:test'
import assert from 'node:assert/strict'

import { ws } from '../../../server'
import { GameWsGateway } from './gameWsGateway'

test('notifyPlayerQuitGame excludes leaver when requested', () => {
  const gateway = new GameWsGateway()
  const roomKey = '66'
  const payload = { roomId: 66, userId: 1 }
  const calls: Array<{
    method: 'room' | 'except'
    roomKey: string
    excludeUserId?: number
    message: unknown
  }> = []

  const originBroadcast = ws.broadcastGameRoom.bind(ws)
  const originBroadcastExcept = ws.broadcastGameRoomExcept.bind(ws)

  ;(
    ws as typeof ws & { broadcastGameRoom: typeof ws.broadcastGameRoom }
  ).broadcastGameRoom = (rk, msg) => {
    calls.push({ method: 'room', roomKey: rk, message: msg })
  }
  ;(
    ws as typeof ws & {
      broadcastGameRoomExcept: typeof ws.broadcastGameRoomExcept
    }
  ).broadcastGameRoomExcept = (rk, uid, msg) => {
    calls.push({
      method: 'except',
      roomKey: rk,
      excludeUserId: uid,
      message: msg
    })
  }

  try {
    gateway.notifyPlayerQuitGame(roomKey, payload, { excludeUserId: 1 })
    assert.equal(calls.length, 1)
    assert.equal(calls[0]?.method, 'except')
    assert.equal(calls[0]?.roomKey, roomKey)
    assert.equal(calls[0]?.excludeUserId, 1)
    assert.deepEqual(calls[0]?.message, {
      type: 'player-quit-game',
      data: payload
    })
  } finally {
    ;(
      ws as typeof ws & { broadcastGameRoom: typeof ws.broadcastGameRoom }
    ).broadcastGameRoom = originBroadcast
    ;(
      ws as typeof ws & {
        broadcastGameRoomExcept: typeof ws.broadcastGameRoomExcept
      }
    ).broadcastGameRoomExcept = originBroadcastExcept
  }
})

test('notifyPlayerLeftGame excludes leaver when requested', () => {
  const gateway = new GameWsGateway()
  const roomKey = '67'
  const payload = { roomId: 67, userId: 2 }
  const calls: Array<{
    method: 'room' | 'except'
    roomKey: string
    excludeUserId?: number
    message: unknown
  }> = []

  const originBroadcast = ws.broadcastGameRoom.bind(ws)
  const originBroadcastExcept = ws.broadcastGameRoomExcept.bind(ws)

  ;(
    ws as typeof ws & { broadcastGameRoom: typeof ws.broadcastGameRoom }
  ).broadcastGameRoom = (rk, msg) => {
    calls.push({ method: 'room', roomKey: rk, message: msg })
  }
  ;(
    ws as typeof ws & {
      broadcastGameRoomExcept: typeof ws.broadcastGameRoomExcept
    }
  ).broadcastGameRoomExcept = (rk, uid, msg) => {
    calls.push({
      method: 'except',
      roomKey: rk,
      excludeUserId: uid,
      message: msg
    })
  }

  try {
    gateway.notifyPlayerLeftGame(roomKey, payload, { excludeUserId: 2 })
    assert.equal(calls.length, 1)
    assert.equal(calls[0]?.method, 'except')
    assert.equal(calls[0]?.roomKey, roomKey)
    assert.equal(calls[0]?.excludeUserId, 2)
    assert.deepEqual(calls[0]?.message, {
      type: 'player-left-game',
      data: payload
    })
  } finally {
    ;(
      ws as typeof ws & { broadcastGameRoom: typeof ws.broadcastGameRoom }
    ).broadcastGameRoom = originBroadcast
    ;(
      ws as typeof ws & {
        broadcastGameRoomExcept: typeof ws.broadcastGameRoomExcept
      }
    ).broadcastGameRoomExcept = originBroadcastExcept
  }
})
