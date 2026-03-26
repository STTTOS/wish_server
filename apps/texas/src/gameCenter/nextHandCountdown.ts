import type { WsMessage } from '../ws/ws-event-types'

import { ws } from '../server'
import { rooms } from './index'

type CountdownState = {
  roomId: string
  roomIdNumber: number
  lockTimer: NodeJS.Timeout
  dealTimer: NodeJS.Timeout
  startTimer: NodeJS.Timeout
  endsAt: number
  lockAt: number
}

const countdowns = new Map<string, CountdownState>()

const LOCK_DELAY_MS = 3000
const DEAL_AFTER_LOCK_MS = 2000
const START_AFTER_DEAL_MS = 2000

type NextHandHooks = {
  canStart: () => boolean
  onLock: () => Promise<void> | void
  onDeal: () => Promise<void> | void
  onStart: () => Promise<void> | void
}

const hooksMap = new Map<string, NextHandHooks>()

function broadcastCancelled(roomId: number) {
  const msg: WsMessage<'next-hand-countdown-cancelled'> = {
    type: 'next-hand-countdown-cancelled',
    data: { roomId }
  }
  ws.broadcast(String(roomId), msg)
}

export function cancelNextHandCountdown(roomId: string) {
  const state = countdowns.get(roomId)
  if (!state) return

  clearTimeout(state.lockTimer)
  clearTimeout(state.dealTimer)
  clearTimeout(state.startTimer)
  countdowns.delete(roomId)

  broadcastCancelled(state.roomIdNumber)
}

export function registerNextHandHooks(roomId: string, hooks: NextHandHooks) {
  hooksMap.set(roomId, hooks)
}

export function unregisterNextHandHooks(roomId: string) {
  hooksMap.delete(roomId)
}

export function maybeStartNextHandCountdown(roomId: string) {
  if (countdowns.has(roomId)) return

  const texas = rooms.get(roomId)
  if (!texas) return

  // 仅在 idle（上一手结束）时允许进入下一手倒计时
  if ((texas.controller.status as unknown as string) !== 'idle') return

  const seatedCount = texas.room.getPlayersBySeatStatus('on-set').length
  if (seatedCount < 2) {
    broadcastCancelled(Number(roomId))
    return
  }

  const hooks = hooksMap.get(roomId)
  if (!hooks) return

  const serverNow = Date.now()
  const lockAt = serverNow + LOCK_DELAY_MS
  const endsAt = lockAt + DEAL_AFTER_LOCK_MS + START_AFTER_DEAL_MS

  const startedMsg: WsMessage<'next-hand-countdown-started'> = {
    type: 'next-hand-countdown-started',
    data: {
      roomId: Number(roomId),
      endsAt,
      lockAt,
      serverNow
    }
  }
  ws.broadcast(roomId, startedMsg)

  const lockTimer = setTimeout(async () => {
    try {
      if (!hooks.canStart()) return cancelNextHandCountdown(roomId)
      await hooks.onLock()
    } catch {
      cancelNextHandCountdown(roomId)
    }
  }, LOCK_DELAY_MS)

  const dealTimer = setTimeout(async () => {
    if (!hooks.canStart()) return cancelNextHandCountdown(roomId)
    try {
      await hooks.onDeal()
    } catch {
      cancelNextHandCountdown(roomId)
    }
  }, LOCK_DELAY_MS + DEAL_AFTER_LOCK_MS)

  const startTimer = setTimeout(async () => {
    if (!hooks.canStart()) return cancelNextHandCountdown(roomId)
    try {
      await hooks.onStart()
    } finally {
      countdowns.delete(roomId)
    }
  }, LOCK_DELAY_MS + DEAL_AFTER_LOCK_MS + START_AFTER_DEAL_MS)

  countdowns.set(roomId, {
    roomId,
    roomIdNumber: Number(roomId),
    lockTimer,
    dealTimer,
    startTimer,
    endsAt,
    lockAt
  })
}
