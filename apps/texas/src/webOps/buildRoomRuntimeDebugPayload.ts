import type { Texas } from 'texas-poker-core'

import prisma, { room } from '../models'
import formatTime from '../utils/formatTime'
import { gameRuntimeRegistry } from '../router/game/services/runtimeRegistry'

export type RoomRuntimeDebugSeatRow = {
  userId: number
  name: string
  seatStatus: 'on-set' | 'hang'
  playerStatus: string
  role: string | null
  balance: number
  leavePending: boolean
  onlineStatus: 'online' | 'offline'
  isActivePlayer: boolean
  canFoldDueToLeave: boolean
  inRoomMember: boolean
}

export type RoomRuntimeDebugPayload = {
  roomId: number
  capturedAt: string
  db: {
    exists: boolean
    gameStatus: string | null
    deletedAt: string | null
    activeCode: string | null
    ownerId: number | null
    memberUserIds: number[]
    members: Array<{ userId: number; name: string; joinedAt: string | null }>
  }
  runtimeAttached: boolean
  currentMatchId: number | null
  quitBlockedUntilBlindsPosted: boolean
  pendingLeaveUserIds: number[]
  offlineUserIds: number[]
  pendingPostBigBlindUserIds: number[]
  engine: null | {
    controllerStatus: string
    roomStatus: string
    activePlayerId: number | null
    onSet: RoomRuntimeDebugSeatRow[]
    hang: RoomRuntimeDebugSeatRow[]
    allInRoomUserIds: number[]
  }
  drift: {
    /** Core on-set 有、RoomMember 无 */
    onSetWithoutMember: number[]
    /** RoomMember 有、Core 全房间（on-set+hang）无 */
    memberWithoutEngine: number[]
    /**
     * 幽灵主嫌疑：环上仍有、库中已无成员、且不在 pendingLeave。
     * 常见于 quit 后 cancelQueuedLeave / flush 失败后的孤儿座。
     */
    onSetWithoutMemberAndNotPendingLeave: number[]
    /** hang 残留但已无 RoomMember（观战应被名单过滤，但环上可能仍有） */
    hangWithoutMember: number[]
  }
  latestMatch: null | {
    id: number
    startedAt: string | null
    endedAt: string | null
  }
}

function mapSeatRow(input: {
  texas: Texas
  roomKey: string
  seatStatus: 'on-set' | 'hang'
  memberUserIds: ReadonlySet<number>
  player: ReturnType<Texas['room']['getPlayersBySeatStatus']>[number]
}): RoomRuntimeDebugSeatRow {
  const { texas, roomKey, seatStatus, memberUserIds, player } = input
  const userId = player.getUserInfo().id
  const activeId = texas.controller.activePlayer?.getUserInfo().id ?? null
  return {
    userId,
    name: player.getUserInfo().name,
    seatStatus,
    playerStatus: String(player.getStatus()),
    role: player.getRole() ?? null,
    balance: player.balance,
    leavePending: gameRuntimeRegistry.hasQueuedLeave(roomKey, userId),
    onlineStatus: gameRuntimeRegistry.getUserConnectionStatus(roomKey, userId),
    isActivePlayer: activeId === userId,
    canFoldDueToLeave: texas.canFoldDueToLeave(userId),
    inRoomMember: memberUserIds.has(userId)
  }
}

/**
 * 管理端 / 本地排障：对比 RoomMember 与进程内 Core 座位环（含 leavePending）。
 * 无 runtime 时仍返回 DB 侧，engine/drift 标空或仅基于成员。
 */
export async function buildRoomRuntimeDebugPayload(
  roomId: number
): Promise<RoomRuntimeDebugPayload> {
  const roomKey = String(roomId)
  const capturedAt = formatTime(new Date()) ?? new Date().toISOString()

  const [dbRoom, memberRows, latestMatch] = await Promise.all([
    room.findUnique({
      where: { id: roomId },
      select: {
        id: true,
        gameStatus: true,
        deletedAt: true,
        activeCode: true,
        ownerId: true
      }
    }),
    prisma.roomMember.findMany({
      where: { roomId },
      select: {
        userId: true,
        joinedAt: true,
        user: { select: { name: true } }
      },
      orderBy: { joinedAt: 'asc' }
    }),
    prisma.match.findFirst({
      where: { roomId },
      orderBy: { id: 'desc' },
      select: { id: true, startedAt: true, endedAt: true }
    })
  ])

  const memberUserIdList: number[] = memberRows.map((m) => m.userId)
  const memberUserIds = new Set<number>(memberUserIdList)

  let runtime: ReturnType<typeof gameRuntimeRegistry.getOrThrow> | null = null
  if (gameRuntimeRegistry.hasTexas(roomKey)) {
    try {
      runtime = gameRuntimeRegistry.getOrThrow(roomKey)
    } catch {
      runtime = null
    }
  }

  const pendingLeaveUserIds: number[] = runtime
    ? Array.from(runtime.pendingLeaveByUserId)
    : []
  const offlineUserIds: number[] = runtime
    ? Array.from(runtime.offlineUserIds)
    : []
  const pendingPostBigBlindUserIds: number[] = runtime
    ? Array.from(runtime.pendingPostBigBlindUserIds)
    : []

  let engine: RoomRuntimeDebugPayload['engine'] = null
  let drift: RoomRuntimeDebugPayload['drift'] = {
    onSetWithoutMember: [],
    memberWithoutEngine: memberUserIdList,
    onSetWithoutMemberAndNotPendingLeave: [],
    hangWithoutMember: []
  }

  if (runtime?.texas) {
    const texas = runtime.texas
    const onSetPlayers = texas.room.getPlayersBySeatStatus('on-set')
    const hangPlayers = texas.room.getPlayersBySeatStatus('hang')
    const onSet = onSetPlayers.map((player) =>
      mapSeatRow({
        texas,
        roomKey,
        seatStatus: 'on-set',
        memberUserIds,
        player
      })
    )
    const hang = hangPlayers.map((player) =>
      mapSeatRow({
        texas,
        roomKey,
        seatStatus: 'hang',
        memberUserIds,
        player
      })
    )
    const allInRoomUserIds: number[] = texas.room
      .getAllPlayers()
      .map((p) => p.getUserInfo().id)
    const onSetIds: number[] = onSet.map((s) => s.userId)
    const hangIds: number[] = hang.map((s) => s.userId)
    const engineIds = new Set<number>([...onSetIds, ...hangIds])

    engine = {
      controllerStatus: String(texas.controller.status),
      roomStatus: String(texas.room.status),
      activePlayerId: texas.controller.activePlayer?.getUserInfo().id ?? null,
      onSet,
      hang,
      allInRoomUserIds
    }

    const onSetWithoutMember = onSetIds.filter((id) => !memberUserIds.has(id))
    const hangWithoutMember = hangIds.filter((id) => !memberUserIds.has(id))
    const pendingSet = new Set<number>(pendingLeaveUserIds)
    drift = {
      onSetWithoutMember,
      memberWithoutEngine: memberUserIdList.filter((id) => !engineIds.has(id)),
      onSetWithoutMemberAndNotPendingLeave: onSetWithoutMember.filter(
        (id) => !pendingSet.has(id)
      ),
      hangWithoutMember
    }
  }

  return {
    roomId,
    capturedAt,
    db: {
      exists: dbRoom != null,
      gameStatus: dbRoom?.gameStatus ?? null,
      deletedAt: formatTime(dbRoom?.deletedAt ?? null),
      activeCode: dbRoom?.activeCode ?? null,
      ownerId: dbRoom?.ownerId ?? null,
      memberUserIds: memberUserIdList,
      members: memberRows.map((m) => ({
        userId: m.userId,
        name: m.user.name,
        joinedAt: formatTime(m.joinedAt)
      }))
    },
    runtimeAttached: runtime != null,
    currentMatchId: runtime?.currentMatchId ?? null,
    quitBlockedUntilBlindsPosted: runtime
      ? Boolean(runtime.quitBlockedUntilBlindsPosted)
      : false,
    pendingLeaveUserIds,
    offlineUserIds,
    pendingPostBigBlindUserIds,
    engine,
    drift,
    latestMatch: latestMatch
      ? {
          id: latestMatch.id,
          startedAt: formatTime(latestMatch.startedAt),
          endedAt: formatTime(latestMatch.endedAt)
        }
      : null
  }
}
