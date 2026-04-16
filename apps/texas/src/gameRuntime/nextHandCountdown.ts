import type { WsMessage } from '../ws/ws-event-types'

import { logger } from '../logger'
import { gameRuntimeConfig } from '../utils/gameRuntimeConfig'
import { gameRuntimeRegistry } from '../router/game/services/runtimeRegistry'

/**
 * 管理“对局间隔”倒计时：
 * - 上一手结束 → 延迟 PUSH → 广播 started（endsAt / lockAt）
 * - lockAt：坐席锁定、房间视为开局（in_hand）
 * - endsAt：分配角色 → 再 DEAL → 再 START
 */
type CountdownState = {
  roomId: number
  lockTimer: NodeJS.Timeout
  assignRolesTimer: NodeJS.Timeout
  dealTimer: NodeJS.Timeout
  startTimer: NodeJS.Timeout
  endsAt: number
  lockAt: number
}

const countdowns = new Map<number, CountdownState>()
/** 尚未发出 `next-hand-countdown-started` 的推送延迟定时器 */
const pendingPushByRoomId = new Map<number, NodeJS.Timeout>()

type NextHandHooks = {
  canStart: () => boolean
  onLock: () => Promise<void> | void
  /** `endsAt` 到达：分配角色并落库 */
  onAssignRoles: () => Promise<void> | void
  onDeal: () => Promise<void> | void
  onStart: () => Promise<void> | void
}

const hooksMap = new Map<number, NextHandHooks>()

type NextHandCountdownMessage =
  | WsMessage<'next-hand-countdown-started'>
  | WsMessage<'next-hand-countdown-cancelled'>

type NextHandCountdownBroadcaster = (
  roomId: number,
  msg: NextHandCountdownMessage
) => void

let nextHandCountdownBroadcaster: NextHandCountdownBroadcaster | null = null

/**
 * 注入 next-hand 倒计时广播实现（通常由 SocketServer 在启动时注册）。
 */
export function setNextHandCountdownBroadcaster(
  broadcaster: NextHandCountdownBroadcaster
) {
  nextHandCountdownBroadcaster = broadcaster
}

function broadcastNextHandCountdown(
  roomId: number,
  msg: NextHandCountdownMessage
) {
  if (!nextHandCountdownBroadcaster) {
    logger.warn(
      `[next-hand-countdown] broadcaster not configured, skip broadcast, roomId=${roomId}, type=${msg.type}`
    )
    return
  }
  nextHandCountdownBroadcaster(roomId, msg)
}

function broadcastCancelled(roomId: number) {
  const msg: WsMessage<'next-hand-countdown-cancelled'> = {
    type: 'next-hand-countdown-cancelled',
    data: { roomId }
  }
  broadcastNextHandCountdown(roomId, msg)
}

export function cancelNextHandCountdown(roomId: number) {
  const pendingPush = pendingPushByRoomId.get(roomId)
  if (pendingPush) {
    clearTimeout(pendingPush)
    pendingPushByRoomId.delete(roomId)
    logger.info(
      `[next-hand-countdown] cancelled during push delay, roomId=${roomId}`
    )
    return
  }

  const state = countdowns.get(roomId)
  if (!state) return

  clearTimeout(state.lockTimer)
  clearTimeout(state.assignRolesTimer)
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

function startCountdownAfterPushDelay(roomId: number) {
  const texas = gameRuntimeRegistry.getTexas(String(roomId))
  if (!texas) {
    logger.info(
      `[next-hand-countdown] skip after delay, runtime missing, roomId=${roomId}`
    )
    return
  }

  if ((texas.controller.status as unknown as string) !== 'idle') {
    logger.info(
      `[next-hand-countdown] skip after delay, status=${String(
        texas.controller.status
      )}, roomId=${roomId}`
    )
    return
  }

  const seatedCount = texas.room.getPlayersBySeatStatus('on-set').length
  if (seatedCount < 2) {
    broadcastCancelled(roomId)
    logger.info(
      `[next-hand-countdown] skip after delay, seatedCount=${seatedCount}, roomId=${roomId}`
    )
    return
  }

  const hooks = hooksMap.get(roomId)
  if (!hooks) {
    logger.error(
      `[next-hand-countdown] hooks missing after delay, roomId=${roomId}`
    )
    return
  }

  const serverNow = Date.now()
  const lockOffset = gameRuntimeConfig.getNextHandLockAtOffsetMs()
  const endsOffset = gameRuntimeConfig.getNextHandEndsAtOffsetMs()
  const lockAt = serverNow + lockOffset
  const endsAt = serverNow + endsOffset

  const startedMsg: WsMessage<'next-hand-countdown-started'> = {
    type: 'next-hand-countdown-started',
    data: {
      roomId,
      endsAt,
      lockAt,
      serverNow
    }
  }
  broadcastNextHandCountdown(roomId, startedMsg)
  logger.info(
    `[next-hand-countdown] started, roomId=${roomId}, lockAt=${lockAt}, endsAt=${endsAt}`
  )

  // lockAt 到达, 坐席锁定, 不可再退出游戏
  const lockTimer = setTimeout(async () => {
    try {
      if (!hooks.canStart()) return cancelNextHandCountdown(roomId)
      await hooks.onLock()
      logger.info(`[next-hand-countdown] lock done, roomId=${roomId}`)
    } catch (e) {
      logger.error(`[next-hand-countdown] lock failed, roomId=${roomId}`, e)
      cancelNextHandCountdown(roomId)
    }
  }, lockOffset)

  // endsAt 到达, 分配角色
  const assignRolesTimer = setTimeout(async () => {
    try {
      if (!hooks.canStart()) return cancelNextHandCountdown(roomId)
      await hooks.onAssignRoles()
      logger.info(`[next-hand-countdown] assign roles done, roomId=${roomId}`)
    } catch (e) {
      logger.error(
        `[next-hand-countdown] assign roles failed, roomId=${roomId}`,
        e
      )
      cancelNextHandCountdown(roomId)
    }
  }, endsOffset)

  // endsAt 到达后，再延迟一段时间发牌
  const dealAfter = gameRuntimeConfig.getNextHandDealAfterEndMs()
  const dealDelay = endsOffset + dealAfter
  const dealTimer = setTimeout(async () => {
    if (!hooks.canStart()) return cancelNextHandCountdown(roomId)
    try {
      await hooks.onDeal()
      logger.info(`[next-hand-countdown] deal done, roomId=${roomId}`)
    } catch (e) {
      logger.error(`[next-hand-countdown] deal failed, roomId=${roomId}`, e)
      cancelNextHandCountdown(roomId)
    }
  }, dealDelay)

  const startAfter = gameRuntimeConfig.getNextHandStartAfterDealMs()
  const startDelay = dealDelay + startAfter
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
  }, startDelay)

  countdowns.set(roomId, {
    roomId,
    lockTimer,
    assignRolesTimer,
    dealTimer,
    startTimer,
    endsAt,
    lockAt
  })
}

export type NextHandCountdownSnapshot =
  | { state: 'none' }
  /** 已排期推送 `next-hand-countdown-started`，尚未带 endsAt/lockAt */
  | { state: 'push_delay_scheduled' }
  | { state: 'active'; endsAt: number; lockAt: number }

/**
 * 供 HTTP 快照等与 WS `next-hand-countdown-*` 对齐的局间倒计时状态。
 */
export function getNextHandCountdownSnapshot(
  roomId: number
): NextHandCountdownSnapshot {
  if (countdowns.has(roomId)) {
    const c = countdowns.get(roomId)!
    return { state: 'active', endsAt: c.endsAt, lockAt: c.lockAt }
  }
  if (pendingPushByRoomId.has(roomId)) {
    return { state: 'push_delay_scheduled' }
  }
  return { state: 'none' }
}

export function maybeStartNextHandCountdown(roomId: number) {
  if (countdowns.has(roomId) || pendingPushByRoomId.has(roomId)) {
    logger.info(
      `[next-hand-countdown] skip start, already scheduled or running, roomId=${roomId}`
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

  const pushDelayMs = gameRuntimeConfig.getNextHandCountdownPushDelayMs()
  const pushTimer = setTimeout(() => {
    pendingPushByRoomId.delete(roomId)
    startCountdownAfterPushDelay(roomId)
  }, pushDelayMs)

  pendingPushByRoomId.set(roomId, pushTimer)
  logger.info(
    `[next-hand-countdown] push scheduled in ${pushDelayMs}ms, roomId=${roomId}`
  )
}
