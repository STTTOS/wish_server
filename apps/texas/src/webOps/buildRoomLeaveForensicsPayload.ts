import formatTime from '../utils/formatTime'
import prisma, {
  room,
  user,
  matchDomainEvent,
  engineFatalIncident
} from '../models'

export type RoomLeaveForensicsPayload = {
  roomId: number
  capturedAt: string
  /**
   * 磁带能力说明：能否回答「是否离场弃牌 / 手结束后是否仍在环上发下一手」。
   * `pendingLeave` / HTTP quit 本身不落磁带，只能从 TurnEnded(leave) + 下一手 RolesAssigned 反推。
   */
  tapeCapabilities: {
    canProveLeaveFold: true
    canProveStillDealtNextHand: true
    canProveHttpQuitOrPendingLeave: false
    leaveFoldSignal: 'TurnEnded.payload.reason === "leave" (+ userId)'
    note: string
  }
  room: null | {
    gameStatus: string
    deletedAt: string | null
    activeCode: string | null
    memberUserIds: number[]
  }
  matchesAnalyzed: number
  userNamesById: Record<string, string>
  /**
   * 各手 RolesAssigned 座位（按 matchId 升序）。
   * 若某人在本手已 TurnEnded(leave) 后仍出现在下一手 RolesAssigned → 手结束后未摘环。
   */
  rolesAssignedByMatch: Array<{
    matchId: number
    handId: string | null
    startedAt: string | null
    endedAt: string | null
    hasHandEnded: boolean
    userIds: number[]
    players: Array<{ userId: number; role?: string; name?: string }>
    /** 本手 `TurnEnded.reason === leave` 的 userId（= 离场弃牌成功） */
    leaveFoldUserIds: number[]
  }>
  leaveRelatedEvents: Array<{
    id: number
    matchId: number
    handId: string | null
    seq: number
    eventType: string
    payload: unknown
    createdAt: string | null
  }>
  seatDiffBetweenHands: Array<{
    fromMatchId: number
    toMatchId: number
    joinedUserIds: number[]
    leftUserIds: number[]
  }>
  /**
   * 自动嫌疑：本手已离场弃牌（TurnEnded leave），下一手 RolesAssigned 仍在。
   * 对应「HandEnded 后 flushDeferred 未摘环 / 摘环失败 / 同手又回房保留座位」。
   */
  ghostSuspectsAfterLeaveFold: Array<{
    userId: number
    name: string | null
    leaveFoldMatchId: number
    nextMatchId: number
    leaveFoldAt: string | null
    diagnosis: 'leave_fold_then_still_dealt_next_hand'
  }>
  /**
   * 较弱信号：连续两手都在 RolesAssigned，且前手没有任何 leave fold。
   * 可能是正常继续坐；也可能是 quit 后 pendingLeave 被 cancel、本手从未轮到自动弃牌。
   * 需结合服务端 quit 日志 / 当时 runtime-debug 才能坐实。
   */
  stayedWithoutLeaveFold: Array<{
    userId: number
    name: string | null
    fromMatchId: number
    toMatchId: number
  }>
  engineFatals: Array<{
    id: number
    matchId: number | null
    message: string
    createdAt: string | null
  }>
}

function extractRolesAssignedPlayers(
  payload: unknown
): Array<{ userId: number; role?: string; name?: string }> {
  if (!payload || typeof payload !== 'object') return []
  const players = (payload as { players?: unknown }).players
  if (!Array.isArray(players)) return []
  const out: Array<{ userId: number; role?: string; name?: string }> = []
  for (const raw of players) {
    if (!raw || typeof raw !== 'object') continue
    const row = raw as Record<string, unknown>
    const userId = Number(row.userId ?? row.id)
    if (!Number.isInteger(userId) || userId <= 0) continue
    out.push({
      userId,
      role: typeof row.role === 'string' ? row.role : undefined,
      name: typeof row.name === 'string' ? row.name : undefined
    })
  }
  return out
}

function extractTurnEndedLeaveUserId(payload: unknown): number | null {
  if (!payload || typeof payload !== 'object') return null
  const row = payload as { reason?: unknown; userId?: unknown }
  if (row.reason !== 'leave') return null
  const userId = Number(row.userId)
  if (!Number.isInteger(userId) || userId <= 0) return null
  return userId
}

/**
 * 事后排障：不依赖进程内 runtime，从 MatchDomainEvent 回答：
 * 1) 本手是否离场弃牌（TurnEnded reason=leave）
 * 2) 手结束后是否仍被发下一手（下一手 RolesAssigned 仍含该 userId）
 */
export async function buildRoomLeaveForensicsPayload(
  roomId: number,
  options?: { matchLimit?: number }
): Promise<RoomLeaveForensicsPayload | null> {
  const matchLimit = Math.min(Math.max(options?.matchLimit ?? 30, 1), 100)
  const capturedAt = formatTime(new Date()) ?? new Date().toISOString()

  const dbRoom = await room.findUnique({
    where: { id: roomId },
    select: {
      id: true,
      gameStatus: true,
      deletedAt: true,
      activeCode: true,
      members: { select: { userId: true } }
    }
  })
  if (!dbRoom) return null

  const matches = await prisma.match.findMany({
    where: { roomId },
    orderBy: { id: 'desc' },
    take: matchLimit,
    select: { id: true, startedAt: true, endedAt: true }
  })
  const matchIdsAsc = [...matches].sort((a, b) => a.id - b.id).map((m) => m.id)
  const matchMeta = new Map<
    number,
    { startedAt: string | null; endedAt: string | null }
  >(
    matches.map((m) => [
      m.id,
      {
        startedAt: formatTime(m.startedAt),
        endedAt: formatTime(m.endedAt)
      }
    ])
  )

  const events =
    matchIdsAsc.length === 0
      ? []
      : await matchDomainEvent.findMany({
          where: {
            roomId,
            matchId: { in: matchIdsAsc },
            eventType: {
              in: ['RolesAssigned', 'HandEnded', 'TurnEnded']
            }
          },
          orderBy: [{ matchId: 'asc' }, { id: 'asc' }],
          select: {
            id: true,
            matchId: true,
            handId: true,
            seq: true,
            eventType: true,
            payload: true,
            createdAt: true
          }
        })

  const leaveFoldAtByMatchUser = new Map<string, string | null>()
  const leaveFoldUserIdsByMatch = new Map<number, Set<number>>()
  const hasHandEndedByMatch = new Set<number>()

  for (const e of events) {
    if (e.eventType === 'HandEnded') {
      hasHandEndedByMatch.add(e.matchId)
      continue
    }
    if (e.eventType !== 'TurnEnded') continue
    const uid = extractTurnEndedLeaveUserId(e.payload)
    if (uid == null) continue
    const set = leaveFoldUserIdsByMatch.get(e.matchId) ?? new Set<number>()
    set.add(uid)
    leaveFoldUserIdsByMatch.set(e.matchId, set)
    leaveFoldAtByMatchUser.set(`${e.matchId}:${uid}`, formatTime(e.createdAt))
  }

  const rolesAssignedByMatch: RoomLeaveForensicsPayload['rolesAssignedByMatch'] =
    []
  for (const matchId of matchIdsAsc) {
    const rolesEv = events.find(
      (e) => e.matchId === matchId && e.eventType === 'RolesAssigned'
    )
    const players = extractRolesAssignedPlayers(rolesEv?.payload)
    const meta = matchMeta.get(matchId)
    const leaveFoldUserIds = [...(leaveFoldUserIdsByMatch.get(matchId) ?? [])]
    rolesAssignedByMatch.push({
      matchId,
      handId: rolesEv?.handId ?? null,
      startedAt: meta?.startedAt ?? null,
      endedAt: meta?.endedAt ?? null,
      hasHandEnded: hasHandEndedByMatch.has(matchId),
      userIds: players.map((p) => p.userId),
      players,
      leaveFoldUserIds
    })
  }

  const seatDiffBetweenHands: RoomLeaveForensicsPayload['seatDiffBetweenHands'] =
    []
  const ghostSuspectsAfterLeaveFold: RoomLeaveForensicsPayload['ghostSuspectsAfterLeaveFold'] =
    []
  const stayedWithoutLeaveFold: RoomLeaveForensicsPayload['stayedWithoutLeaveFold'] =
    []

  for (let i = 1; i < rolesAssignedByMatch.length; i++) {
    const prev = rolesAssignedByMatch[i - 1]
    const next = rolesAssignedByMatch[i]
    const prevSet = new Set(prev.userIds)
    const nextSet = new Set(next.userIds)
    seatDiffBetweenHands.push({
      fromMatchId: prev.matchId,
      toMatchId: next.matchId,
      joinedUserIds: [...nextSet].filter((id) => !prevSet.has(id)),
      leftUserIds: [...prevSet].filter((id) => !nextSet.has(id))
    })

    const leaveFoldPrev = new Set(prev.leaveFoldUserIds)
    for (const userId of next.userIds) {
      if (!prevSet.has(userId)) continue
      if (leaveFoldPrev.has(userId)) {
        ghostSuspectsAfterLeaveFold.push({
          userId,
          name: null,
          leaveFoldMatchId: prev.matchId,
          nextMatchId: next.matchId,
          leaveFoldAt:
            leaveFoldAtByMatchUser.get(`${prev.matchId}:${userId}`) ?? null,
          diagnosis: 'leave_fold_then_still_dealt_next_hand'
        })
      } else {
        stayedWithoutLeaveFold.push({
          userId,
          name: null,
          fromMatchId: prev.matchId,
          toMatchId: next.matchId
        })
      }
    }
  }

  const involvedUserIds = new Set<number>()
  for (const row of rolesAssignedByMatch) {
    for (const id of row.userIds) involvedUserIds.add(id)
    for (const id of row.leaveFoldUserIds) involvedUserIds.add(id)
  }
  for (const id of dbRoom.members.map((m) => m.userId)) involvedUserIds.add(id)

  const users =
    involvedUserIds.size === 0
      ? []
      : await user.findMany({
          where: { id: { in: [...involvedUserIds] } },
          select: { id: true, name: true }
        })
  const userNamesById: Record<string, string> = {}
  for (const u of users) {
    userNamesById[String(u.id)] = u.name
  }
  for (const s of ghostSuspectsAfterLeaveFold) {
    s.name = userNamesById[String(s.userId)] ?? null
  }
  for (const s of stayedWithoutLeaveFold) {
    s.name = userNamesById[String(s.userId)] ?? null
  }

  const leaveRelatedEvents = events
    .filter((e) => {
      if (e.eventType === 'HandEnded') return true
      if (e.eventType === 'TurnEnded') {
        return extractTurnEndedLeaveUserId(e.payload) != null
      }
      return false
    })
    .map((e) => ({
      id: e.id,
      matchId: e.matchId,
      handId: e.handId,
      seq: e.seq,
      eventType: e.eventType,
      payload: e.payload,
      createdAt: formatTime(e.createdAt)
    }))

  const engineFatals = await engineFatalIncident.findMany({
    where: { roomId },
    orderBy: { id: 'desc' },
    take: 20,
    select: {
      id: true,
      matchId: true,
      message: true,
      createdAt: true
    }
  })

  return {
    roomId,
    capturedAt,
    tapeCapabilities: {
      canProveLeaveFold: true,
      canProveStillDealtNextHand: true,
      canProveHttpQuitOrPendingLeave: false,
      leaveFoldSignal: 'TurnEnded.payload.reason === "leave" (+ userId)',
      note: 'Core 离场弃牌落磁带为 TurnEnded(reason=leave)，不是 FoldDueToLeave 事件。HTTP quit / pendingLeave 不落库；若本手未轮到该玩家，可能无 leave fold 但仍应在 HandEnded.flush 摘环——该路径失败只能靠「下一手仍 RolesAssigned」或当时 runtime-debug / 进程日志反证。'
    },
    room: {
      gameStatus: dbRoom.gameStatus,
      deletedAt: formatTime(dbRoom.deletedAt),
      activeCode: dbRoom.activeCode,
      memberUserIds: dbRoom.members.map((m) => m.userId)
    },
    matchesAnalyzed: matches.length,
    userNamesById,
    rolesAssignedByMatch,
    leaveRelatedEvents,
    seatDiffBetweenHands,
    ghostSuspectsAfterLeaveFold,
    stayedWithoutLeaveFold,
    engineFatals: engineFatals.map((f) => ({
      id: f.id,
      matchId: f.matchId,
      message: f.message,
      createdAt: formatTime(f.createdAt)
    }))
  }
}
