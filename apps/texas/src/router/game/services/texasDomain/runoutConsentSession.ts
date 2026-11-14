import { logger } from '../../../../logger'
import { gameRuntimeRegistry } from '../runtimeRegistry'
import { GAME_WS_RUNOUT_CONSENT_TIMEOUT_MS } from '../../../../constants/game'

export type RunoutConsentSession = {
  matchId: number
  allInUserIds: number[]
  deadlineAt: number
  votes: Map<number, boolean>
  timer: ReturnType<typeof setTimeout> | null
  resolved: boolean
}

const sessions = new Map<string, RunoutConsentSession>()

/** 由 drain 模块注入，避免循环依赖。 */
let onConsentFinalized:
  | ((args: {
      roomKey: string
      roomId: number
      runCount: 1 | 2
      matchId: number
      votes: Array<{ userId: number; agree: boolean }>
    }) => Promise<void>)
  | null = null

export function setRunoutConsentFinalizer(
  fn: NonNullable<typeof onConsentFinalized>
): void {
  onConsentFinalized = fn
}

export function getRunoutConsentSession(
  roomKey: string
): RunoutConsentSession | undefined {
  return sessions.get(roomKey)
}

export function clearRunoutConsentSession(roomKey: string): void {
  const s = sessions.get(roomKey)
  if (s?.timer) clearTimeout(s.timer)
  sessions.delete(roomKey)
}

type StartArgs = {
  roomKey: string
  roomId: number
  matchId: number
  allInUserIds: number[]
  notifyOffer: (data: {
    matchId: number
    allInUserIds: number[]
    deadlineAt: number
    timeoutMs: number
    serverNow: number
  }) => void
}

/**
 * 启动跑马协商：推 offer，6s 超时默认否；全员同意才 runCount=2。
 */
export function startRunoutConsentSession(args: StartArgs): void {
  const { roomKey, roomId, matchId, allInUserIds, notifyOffer } = args
  clearRunoutConsentSession(roomKey)

  const serverNow = Date.now()
  const timeoutMs = GAME_WS_RUNOUT_CONSENT_TIMEOUT_MS
  const deadlineAt = serverNow + timeoutMs
  const session: RunoutConsentSession = {
    matchId,
    allInUserIds: [...allInUserIds],
    deadlineAt,
    votes: new Map(),
    timer: null,
    resolved: false
  }
  sessions.set(roomKey, session)

  notifyOffer({
    matchId,
    allInUserIds: session.allInUserIds,
    deadlineAt,
    timeoutMs,
    serverNow
  })

  if (session.allInUserIds.length === 0) {
    // 避开仍持有 room drain lock 的同步路径，防止 finalizer 二次加锁死锁
    setTimeout(() => {
      void finalizeRunoutConsent(roomKey, roomId)
    }, 0)
    return
  }

  session.timer = setTimeout(() => {
    void finalizeRunoutConsent(roomKey, roomId)
  }, timeoutMs)
}

/**
 * 记录投票；收齐后结算。非 allIn / 已结束返回 false。
 */
export function recordRunoutConsentVote(
  roomKey: string,
  roomId: number,
  userId: number,
  agree: boolean
): { ok: true } | { ok: false; message: string } {
  const session = sessions.get(roomKey)
  if (!session || session.resolved) {
    return { ok: false, message: '当前无跑马协商' }
  }
  if (!session.allInUserIds.includes(userId)) {
    return { ok: false, message: '你无需参与本次协商' }
  }
  session.votes.set(userId, agree)
  if (session.votes.size >= session.allInUserIds.length) {
    void finalizeRunoutConsent(roomKey, roomId)
  }
  return { ok: true }
}

function decideRunCount(session: RunoutConsentSession): 1 | 2 {
  if (session.allInUserIds.length === 0) return 1
  const allAgree = session.allInUserIds.every(
    (id) => session.votes.get(id) === true
  )
  return allAgree ? 2 : 1
}

async function finalizeRunoutConsent(
  roomKey: string,
  roomId: number
): Promise<void> {
  const session = sessions.get(roomKey)
  if (!session || session.resolved) return
  session.resolved = true
  if (session.timer) {
    clearTimeout(session.timer)
    session.timer = null
  }

  const runCount = decideRunCount(session)
  const votes = session.allInUserIds.map((userId) => ({
    userId,
    agree: session.votes.get(userId) === true
  }))
  const matchId = session.matchId
  sessions.delete(roomKey)

  if (!onConsentFinalized) {
    logger.error('[runout consent] finalizer not registered')
    return
  }
  if (
    !gameRuntimeRegistry.getTexas(roomKey)?.controller.isAwaitingRunoutConsent
  ) {
    logger.warn(
      `[runout consent] core not awaiting roomKey=${roomKey} (already resolved?)`
    )
    return
  }

  try {
    await onConsentFinalized({ roomKey, roomId, runCount, matchId, votes })
  } catch (err) {
    logger.error(`[runout consent] finalize failed roomKey=${roomKey}`, err)
  }
}
