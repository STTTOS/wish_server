import { logger } from '../../../../logger'
import { gameRuntimeRegistry } from '../runtimeRegistry'
import { gameRuntimeConfig } from '../../../../utils/gameRuntimeConfig'

export type RunoutConsentVoteRow = { userId: number; agree: boolean }

export type RunoutConsentProgressPayload = {
  matchId: number
  stillInUserIds: number[]
  votes: RunoutConsentVoteRow[]
  agreedCount: number
  pendingCount: number
  serverNow: number
  deadlineAt: number
}

export type RunoutConsentSession = {
  matchId: number
  stillInUserIds: number[]
  deadlineAt: number
  votes: Map<number, boolean>
  /** 投票窗口超时 / 否决 pacing 共用；清会话时一并清 */
  timer: ReturnType<typeof setTimeout> | null
  resolved: boolean
  /**
   * 已进入结束窗 pacing（否决或超时）：拒绝后续投票，但尚未 `finalize`
   *（弹窗仍在：否决可看否决者；超时可避弹窗关与翻牌叠帧）。
   */
  voteLocked: boolean
  notifyVote: ((data: RunoutConsentProgressPayload) => void) | null
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

export function buildRunoutConsentProgress(
  session: RunoutConsentSession
): RunoutConsentProgressPayload {
  const votes: RunoutConsentVoteRow[] = []
  for (const userId of session.stillInUserIds) {
    if (!session.votes.has(userId)) continue
    votes.push({ userId, agree: session.votes.get(userId) === true })
  }
  const agreedCount = votes.filter((v) => v.agree).length
  const pendingCount = Math.max(
    0,
    session.stillInUserIds.length - session.votes.size
  )
  return {
    matchId: session.matchId,
    stillInUserIds: [...session.stillInUserIds],
    votes,
    agreedCount,
    pendingCount,
    serverNow: Date.now(),
    deadlineAt: session.deadlineAt
  }
}

/** snapshot 既有引用名 */
export const buildRunoutConsentVoteProgress = buildRunoutConsentProgress

type StartArgs = {
  roomKey: string
  roomId: number
  matchId: number
  stillInUserIds: number[]
  notifyOffer: (data: {
    matchId: number
    stillInUserIds: number[]
    deadlineAt: number
    timeoutMs: number
    serverNow: number
    votes: RunoutConsentVoteRow[]
  }) => void
  notifyVote: (data: RunoutConsentProgressPayload) => void
}

/**
 * 启动跑马协商：推 offer，超时默认否；全员同意 → 二次；
 * 任一否决 / 窗口超时 → pacing 后单次（避免弹窗关与翻牌叠帧）。
 */
export function startRunoutConsentSession(args: StartArgs): void {
  const { roomKey, roomId, matchId, stillInUserIds, notifyOffer, notifyVote } =
    args
  clearRunoutConsentSession(roomKey)

  const serverNow = Date.now()
  const timeoutMs = gameRuntimeConfig.getRunoutConsentTimeoutMs()
  const deadlineAt = serverNow + timeoutMs
  const session: RunoutConsentSession = {
    matchId,
    stillInUserIds: [...stillInUserIds],
    deadlineAt,
    votes: new Map(),
    timer: null,
    resolved: false,
    voteLocked: false,
    notifyVote
  }
  sessions.set(roomKey, session)

  notifyOffer({
    matchId,
    stillInUserIds: session.stillInUserIds,
    deadlineAt,
    timeoutMs,
    serverNow,
    votes: []
  })

  if (session.stillInUserIds.length === 0) {
    // 避开仍持有 room drain lock 的同步路径，防止 finalizer 二次加锁死锁
    setTimeout(() => {
      void finalizeRunoutConsent(roomKey, roomId)
    }, 0)
    return
  }

  session.timer = setTimeout(() => {
    scheduleEndWindowFinalize(roomKey, roomId, session)
  }, timeoutMs)
}

function clearSessionTimer(session: RunoutConsentSession): void {
  if (session.timer) {
    clearTimeout(session.timer)
    session.timer = null
  }
}

/**
 * 锁票 + pacing 后再 finalize（否决 / 超时共用）。
 * 客户端已可展示「协商结束中」或否决者，再开单次跑马。
 */
function scheduleEndWindowFinalize(
  roomKey: string,
  roomId: number,
  session: RunoutConsentSession
): void {
  if (session.voteLocked || session.resolved) return
  session.voteLocked = true
  clearSessionTimer(session)
  const pacingMs = gameRuntimeConfig.getRunoutConsentVetoPacingMs()
  if (pacingMs <= 0) {
    void finalizeRunoutConsent(roomKey, roomId)
    return
  }
  session.timer = setTimeout(() => {
    void finalizeRunoutConsent(roomKey, roomId)
  }, pacingMs)
}

/**
 * 记录投票；先广播进度。
 * - 全员同意：立即结算（二次）
 * - 任一否决：锁票 + pacing 后结算（单次）
 * - 收齐且无否决：同上立即结算
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
  if (session.voteLocked) {
    return { ok: false, message: '协商即将结束' }
  }
  if (!session.stillInUserIds.includes(userId)) {
    return { ok: false, message: '你无需参与本次协商' }
  }
  session.votes.set(userId, agree)
  try {
    session.notifyVote?.(buildRunoutConsentProgress(session))
  } catch (err) {
    logger.error(`[runout consent] notifyVote failed roomKey=${roomKey}`, err)
  }

  if (agree === false) {
    scheduleEndWindowFinalize(roomKey, roomId, session)
    return { ok: true }
  }

  const allVoted = session.votes.size >= session.stillInUserIds.length
  const allAgree = session.stillInUserIds.every(
    (id) => session.votes.get(id) === true
  )
  if (allVoted && allAgree) {
    clearSessionTimer(session)
    void finalizeRunoutConsent(roomKey, roomId)
  }
  return { ok: true }
}

function decideRunCount(session: RunoutConsentSession): 1 | 2 {
  if (session.stillInUserIds.length === 0) return 1
  const allAgree = session.stillInUserIds.every(
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
  session.voteLocked = true
  clearSessionTimer(session)

  const runCount = decideRunCount(session)
  const votes = session.stillInUserIds.map((userId) => ({
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
