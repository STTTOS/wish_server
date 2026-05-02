import test from 'node:test'
import assert from 'node:assert/strict'

import { ws } from '../../../server'
import { GameWsGateway } from './gameWsGateway'

test('notifyPlayerQuitGame unicasts to quitting user only', () => {
  const gateway = new GameWsGateway()
  const roomKey = '66'
  const payload = { roomId: 66, userId: 1, reason: 'quit' as const }
  const calls: Array<{ method: 'toUser'; userId: number; message: unknown }> =
    []

  const originToUser = ws.broadcastGameToUser.bind(ws)
  const mutableWs = ws as typeof ws & {
    broadcastGameToUser: typeof ws.broadcastGameToUser
  }

  mutableWs.broadcastGameToUser = (uid, msg) => {
    calls.push({ method: 'toUser', userId: uid, message: msg })
  }

  try {
    gateway.notifyPlayerQuitGame(roomKey, payload)
    assert.equal(calls.length, 1)
    assert.equal(calls[0]?.method, 'toUser')
    assert.equal(calls[0]?.userId, 1)
    assert.deepEqual(calls[0]?.message, {
      type: 'player-quit-game',
      data: payload
    })
  } finally {
    mutableWs.broadcastGameToUser = originToUser
  }
})

test('notifyPlayerLeftGame excludes leaver when requested', () => {
  const gateway = new GameWsGateway()
  const roomKey = '67'
  const payload = {
    roomId: 67,
    userId: 2,
    name: '玩家2',
    avatarKey: 'cartoon/default'
  }
  const calls: Array<{
    method: 'room' | 'except'
    roomKey: string
    excludeUserId?: number
    message: unknown
  }> = []

  const originBroadcast = ws.broadcastGameRoom.bind(ws)
  const originBroadcastExcept = ws.broadcastGameRoomExcept.bind(ws)
  const mutableWs = ws as typeof ws & {
    broadcastGameRoom: typeof ws.broadcastGameRoom
    broadcastGameRoomExcept: typeof ws.broadcastGameRoomExcept
  }

  mutableWs.broadcastGameRoom = (rk, msg) => {
    calls.push({ method: 'room', roomKey: rk, message: msg })
  }
  mutableWs.broadcastGameRoomExcept = (rk, uid, msg) => {
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
    mutableWs.broadcastGameRoom = originBroadcast
    mutableWs.broadcastGameRoomExcept = originBroadcastExcept
  }
})
