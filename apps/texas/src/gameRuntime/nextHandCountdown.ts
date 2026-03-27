import type { WsMessage } from '../ws/ws-event-types'

import { ws } from '../server'
import { logger } from '../logger'
import { gameRuntimeRegistry } from '../router/game/services/runtimeKit'
import {
  NEXT_HAND_LOCK_DELAY_MS,
  NEXT_HAND_DEAL_AFTER_LOCK_MS,
  NEXT_HAND_START_AFTER_DEAL_MS
} from '../constants/nextHand'

/**
 * 管理“对局间隔”倒计时：
 * - 广播开始/取消事件
 * - 按 lock -> deal -> start 三段推进下一手
 */
type CountdownState = {
  roomId: number
  lockTimer: NodeJS.Timeout
  dealTimer: NodeJS.Timeout
  startTimer: NodeJS.Timeout
  endsAt: number
  lockAt: number
}

const countdowns = new Map<number, CountdownState>()

type NextHandHooks = {
  canStart: () => boolean
  onLock: () => Promise<void> | void
  onDeal: () => Promise<void> | void
  onStart: () => Promise<void> | void
}

const hooksMap = new Map<number, NextHandHooks>()

function broadcastCancelled(roomId: number) {
  const msg: WsMessage<'next-hand-countdown-cancelled'> = {
    type: 'next-hand-countdown-cancelled',
    data: { roomId }
  }
  ws.broadcast(String(roomId), msg)
}

export function cancelNextHandCountdown(roomId: number) {
  const state = countdowns.get(roomId)
  if (!state) return

  clearTimeout(state.lockTimer)
  clearTimeout(state.dealTimer)
  clearTimeout(state.startTimer)
  countdowns.delete(roomId)

  broadcastCancelled(roomId)
  logger.info(`[next-hand-countdown] cancelled, roomId=${roomId}`)
}

export function registerNextHandHooks(roomId: number, hooks: NextHandHooks) {
  hooksMap.set(roomId, hooks)
}

export function unregisterNextHandHooks(roomId: number) {
  hooksMap.delete(roomId)
}

export function maybeStartNextHandCountdown(roomId: number) {
  if (countdowns.has(roomId)) {
    logger.info(
      `[next-hand-countdown] skip start, already running, roomId=${roomId}`
    )
    return
  }

  const texas = gameRuntimeRegistry.getTexas(String(roomId))
  if (!texas) {
    logger.info(
      `[next-hand-countdown] skip start, runtime missing, roomId=${roomId}`
    )
    return
  }

  // 仅在 idle（上一手结束）时允许进入下一手倒计时
  if ((texas.controller.status as unknown as string) !== 'idle') {
    logger.info(
      `[next-hand-countdown] skip start, status=${String(
        texas.controller.status
      )}, roomId=${roomId}`
    )
    return
  }

  const seatedCount = texas.room.getPlayersBySeatStatus('on-set').length
  if (seatedCount < 2) {
    broadcastCancelled(roomId)
    logger.info(
      `[next-hand-countdown] skip start, seatedCount=${seatedCount}, roomId=${roomId}`
    )
    return
  }

  const hooks = hooksMap.get(roomId)
  if (!hooks) {
    logger.error(`[next-hand-countdown] hooks missing, roomId=${roomId}`)
    return
  }

  const serverNow = Date.now()
  const lockAt = serverNow + NEXT_HAND_LOCK_DELAY_MS
  const endsAt =
    lockAt + NEXT_HAND_DEAL_AFTER_LOCK_MS + NEXT_HAND_START_AFTER_DEAL_MS

  const startedMsg: WsMessage<'next-hand-countdown-started'> = {
    type: 'next-hand-countdown-started',
    data: {
      roomId,
      endsAt,
      lockAt,
      serverNow
    }
  }
  ws.broadcast(String(roomId), startedMsg)
  logger.info(
    `[next-hand-countdown] started, roomId=${roomId}, lockAt=${lockAt}, endsAt=${endsAt}`
  )

  const lockTimer = setTimeout(async () => {
    try {
      if (!hooks.canStart()) return cancelNextHandCountdown(roomId)
      await hooks.onLock()
      logger.info(`[next-hand-countdown] lock done, roomId=${roomId}`)
    } catch (e) {
      logger.error(`[next-hand-countdown] lock failed, roomId=${roomId}`, e)
      cancelNextHandCountdown(roomId)
    }
  }, NEXT_HAND_LOCK_DELAY_MS)

  const dealTimer = setTimeout(async () => {
    if (!hooks.canStart()) return cancelNextHandCountdown(roomId)
    try {
      await hooks.onDeal()
      logger.info(`[next-hand-countdown] deal done, roomId=${roomId}`)
    } catch (e) {
      logger.error(`[next-hand-countdown] deal failed, roomId=${roomId}`, e)
      cancelNextHandCountdown(roomId)
    }
  }, NEXT_HAND_LOCK_DELAY_MS + NEXT_HAND_DEAL_AFTER_LOCK_MS)

  const startTimer = setTimeout(async () => {
    if (!hooks.canStart()) return cancelNextHandCountdown(roomId)
    try {
      await hooks.onStart()
      logger.info(`[next-hand-countdown] start done, roomId=${roomId}`)
    } catch (e) {
      logger.error(`[next-hand-countdown] start failed, roomId=${roomId}`, e)
      cancelNextHandCountdown(roomId)
    } finally {
      countdowns.delete(roomId)
    }
  }, NEXT_HAND_LOCK_DELAY_MS + NEXT_HAND_DEAL_AFTER_LOCK_MS + NEXT_HAND_START_AFTER_DEAL_MS)

  countdowns.set(roomId, {
    roomId,
    lockTimer,
    dealTimer,
    startTimer,
    endsAt,
    lockAt
  })
}
