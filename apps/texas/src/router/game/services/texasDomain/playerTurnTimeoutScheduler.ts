import {
  TexasError,
  ActionTypeEnum,
  isFatalTexasErrorCode
} from 'texas-poker-core'

import { logger } from '../../../../logger'
import { gameRuntimeRegistry } from '../runtimeRegistry'
import { handleFatalTexasEngineError } from './handleFatalTexasEngineError'

/** 单进程中央节拍：批量扫描待超时行动，避免每桌独立 setTimeout */
const SWEEP_INTERVAL_MS = 500

type PendingTurn = {
  userId: number
  deadlineAt: number
  handId: string
}

const pendingByRoomKey = new Map<string, PendingTurn>()

let sweepTimer: NodeJS.Timeout | null = null

function ensureSweepStarted(): void {
  if (sweepTimer != null) return
  sweepTimer = setInterval(() => {
    void runDueTimeouts()
  }, SWEEP_INTERVAL_MS)
}

/**
 * 轮到行动：登记本桌唯一待处理项（新 `TurnOffered` 会覆盖上一条）。
 */
export function schedulePlayerTurnTimeout(params: {
  roomKey: string
  userId: number
  deadlineAt: number
  handId: string
}): void {
  const { roomKey, userId, deadlineAt, handId } = params
  pendingByRoomKey.set(roomKey, { userId, deadlineAt, handId })
  ensureSweepStarted()
}

/** 本桌行动已落地或本手结束：取消待超时，避免误触发 */
export function clearPlayerTurnTimeout(roomKey: string): void {
  pendingByRoomKey.delete(roomKey)
}

async function runDueTimeouts(): Promise<void> {
  const now = Date.now()
  const due = [...pendingByRoomKey.entries()].filter(
    ([, p]) => p.deadlineAt <= now
  )
  for (const [roomKey, p] of due) {
    pendingByRoomKey.delete(roomKey)
    await processOneDue(roomKey, p)
  }
}

async function processOneDue(roomKey: string, p: PendingTurn): Promise<void> {
  const texas = gameRuntimeRegistry.getTexas(roomKey)
  if (!texas) return

  const active = texas.controller.activePlayer
  if (!active || active.getUserInfo().id !== p.userId) return

  if (texas.controller.currentHandId !== p.handId) return

  const canCheck = active.getAllowedActions().includes(ActionTypeEnum.CHECK)
  const cmd = canCheck
    ? ({ type: 'CheckDueToTimeout', playerId: p.userId } as const)
    : ({ type: 'FoldDueToTimeout', playerId: p.userId } as const)

  let roomId: number
  try {
    roomId = gameRuntimeRegistry.getOrThrow(roomKey).roomId
  } catch {
    return
  }

  try {
    await texas.dispatchCommand(cmd)
    const { drainAndInterpretTexas } = await import('./drainTexasDomainEvents')
    const { getTexasEventContextForRoom } = await import('./texasEventContext')
    await drainAndInterpretTexas(getTexasEventContextForRoom(roomKey))
  } catch (e: unknown) {
    if (e instanceof TexasError && isFatalTexasErrorCode(e.code)) {
      await handleFatalTexasEngineError({
        error: e,
        roomId,
        roomKey,
        getRuntime: () => gameRuntimeRegistry.getOrThrow(roomKey)
      })
      return
    }
    logger.warn(
      `[turn-timeout] dispatch failed roomKey=${roomKey} cmd=${cmd.type}`,
      e
    )
  }
}
