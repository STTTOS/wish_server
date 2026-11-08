/**
 * Web 管理端：跨对局排障与房间运维（仅管理员）
 */
import type { RoomGameStatus } from '@prisma/texas-client'
import type { RoomOpsLifecycleFilter } from '../webOps/buildRoomOpsListWhere'

import { Prisma } from '@prisma/texas-client'

import router from './instance'
import { apiPrefixWeb } from '../config'
import { assertWebAdmin } from './webAuth'
import formatTime from '../utils/formatTime'
import combinePath from '../utils/combinePath'
import { HTTP_STATUS } from '../constants/httpStatus'
import response, { withList } from '../utils/response'
import { room, assetUsageEvent, engineFatalIncident } from '../models'
import { buildDashboardSummary } from '../webOps/buildDashboardSummary'
import { buildRoomOpsListWhere } from '../webOps/buildRoomOpsListWhere'
import { ROOM_TABLE_TYPES, type RoomTableType } from '../constants/game'
import { buildRoomOpsDetailPayload } from '../webOps/buildRoomOpsDetailPayload'
import { buildRoomRuntimeDebugPayload } from '../webOps/buildRoomRuntimeDebugPayload'
import { buildRoomLeaveForensicsPayload } from '../webOps/buildRoomLeaveForensicsPayload'
import { historicalMemberCountsForRoomIds } from '../webOps/historicalMemberCountsForRoomIds'

const engineFatalWebApi = combinePath(apiPrefixWeb)('/engine-fatal')
const roomOpsWebApi = combinePath(apiPrefixWeb)('/room-ops')
const dashboardWebApi = combinePath(apiPrefixWeb)('/dashboard')
const assetUsageWebApi = combinePath(apiPrefixWeb)('/asset-usage')

router.post(engineFatalWebApi('/list'), async (ctx) => {
  if ((await assertWebAdmin(ctx)) == null) return

  const {
    current: page,
    pageSize: take,
    matchId,
    roomId,
    time
  } = (ctx.request.body ?? {}) as {
    current?: number
    pageSize?: number
    matchId?: number
    roomId?: number
    time?: [string, string]
  }
  if (!page || !take) {
    response.error(ctx, HTTP_STATUS.BAD_REQUEST, '分页参数错误')
    return
  }

  const where: Prisma.EngineFatalIncidentWhereInput = {}
  if (matchId != null && Number.isInteger(matchId) && matchId > 0) {
    where.matchId = matchId
  }
  if (roomId != null && Number.isInteger(roomId) && roomId > 0) {
    where.roomId = roomId
  }
  if (time?.length === 2) {
    where.createdAt = {
      gte: new Date(time[0]),
      lte: new Date(time[1])
    }
  }

  const skip = (page - 1) * take
  const [total, rows] = await Promise.all([
    engineFatalIncident.count({ where }),
    engineFatalIncident.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take
    })
  ])

  response.success(
    ctx,
    withList(
      rows.map((r) => ({
        id: r.id,
        roomId: r.roomId,
        matchId: r.matchId,
        message: r.message,
        payload: r.payload,
        createdAt: formatTime(r.createdAt)
      })),
      total
    )
  )
})

router.post(roomOpsWebApi('/list'), async (ctx) => {
  if ((await assertWebAdmin(ctx)) == null) return

  const {
    current: page,
    pageSize: take,
    gameStatus,
    ownerNameContains: ownerNameContainsRaw,
    tableType: tableTypeRaw,
    roomLifecycle: roomLifecycleRaw
  } = (ctx.request.body ?? {}) as {
    current?: number
    pageSize?: number
    gameStatus?: string
    /** 房主游戏昵称 `User.name` 子串（模糊） */
    ownerNameContains?: string
    tableType?: string
    /** `all` | `active` | `dissolved` */
    roomLifecycle?: string
  }
  if (!page || !take) {
    response.error(ctx, HTTP_STATUS.BAD_REQUEST, '分页参数错误')
    return
  }

  const validStatuses: RoomGameStatus[] = [
    'waiting',
    'entering',
    'starting_hand',
    'in_hand',
    'between_hands'
  ]
  let gameStatusFilter: RoomGameStatus | undefined
  if (gameStatus && gameStatus !== 'all') {
    if (!validStatuses.includes(gameStatus as RoomGameStatus)) {
      response.error(ctx, HTTP_STATUS.BAD_REQUEST, 'gameStatus 参数异常')
      return
    }
    gameStatusFilter = gameStatus as RoomGameStatus
  }

  const ownerNameTrimmed =
    typeof ownerNameContainsRaw === 'string' ? ownerNameContainsRaw.trim() : ''
  const tt = typeof tableTypeRaw === 'string' ? tableTypeRaw.trim() : ''
  if (
    tt &&
    tt !== 'all' &&
    !(ROOM_TABLE_TYPES as readonly string[]).includes(tt)
  ) {
    response.error(ctx, HTTP_STATUS.BAD_REQUEST, 'tableType 参数异常')
    return
  }
  const tableType: RoomTableType | undefined =
    tt && tt !== 'all' ? (tt as RoomTableType) : undefined

  const validLifecycle: RoomOpsLifecycleFilter[] = [
    'all',
    'active',
    'dissolved'
  ]
  let lifecycle: RoomOpsLifecycleFilter = 'all'
  if (roomLifecycleRaw != null && String(roomLifecycleRaw).trim() !== '') {
    const lc = String(roomLifecycleRaw).trim() as RoomOpsLifecycleFilter
    if (!validLifecycle.includes(lc)) {
      response.error(ctx, HTTP_STATUS.BAD_REQUEST, 'roomLifecycle 参数异常')
      return
    }
    lifecycle = lc
  }

  const where = buildRoomOpsListWhere({
    gameStatus: gameStatusFilter,
    ownerNameContains: ownerNameTrimmed || undefined,
    tableType,
    lifecycle
  })

  const skip = (page - 1) * take
  const [total, rows] = await Promise.all([
    room.count({ where }),
    room.findMany({
      where,
      skip,
      take,
      orderBy: [{ activeCode: 'desc' }, { createdAt: 'desc' }],
      include: {
        owner: {
          select: {
            id: true,
            name: true,
            username: true,
            avatarUrl: true,
            avatarKey: true
          }
        },
        _count: { select: { members: true, Match: true } }
      }
    })
  ])

  const roomIds = rows.map((r) => r.id)
  const historicalByRoom = await historicalMemberCountsForRoomIds(roomIds)

  response.success(
    ctx,
    withList(
      rows.map((r) => ({
        id: r.id,
        activeCode: r.activeCode,
        gameStatus: r.gameStatus,
        lowestBetAmount: r.lowestBetAmount,
        initialChips: r.initialChips,
        tableType: r.tableType,
        thinkingTime: r.thinkingTime,
        isPrivate: r.isPrivate,
        sevenTwoBonusEnabled: r.sevenTwoBonusEnabled,
        createdAt: formatTime(r.createdAt),
        owner: r.owner,
        memberCount: r._count.members,
        historicalMemberCount: historicalByRoom.get(r.id) ?? 0,
        matchCount: r._count.Match,
        deletedAt: formatTime(r.deletedAt)
      })),
      total
    )
  )
})

router.post(roomOpsWebApi('/detail'), async (ctx) => {
  if ((await assertWebAdmin(ctx)) == null) return

  const { roomId } = (ctx.request.body ?? {}) as { roomId?: number }
  if (roomId == null || !Number.isInteger(roomId) || roomId <= 0) {
    response.error(ctx, HTTP_STATUS.BAD_REQUEST, 'roomId 参数错误')
    return
  }

  const payload = await buildRoomOpsDetailPayload(roomId)
  if (!payload) {
    response.error(ctx, HTTP_STATUS.NOT_FOUND, '房间不存在')
    return
  }
  response.success(ctx, payload)
})

/**
 * 本地 env 特殊码：非 production 且 `TEXAS_RUNTIME_DEBUG_CODE` 与 body.debugCode 一致时可绕过 admin。
 * 生产环境仍须管理员。
 */
async function assertRoomRuntimeDebugAccess(
  ctx: Parameters<typeof assertWebAdmin>[0]
): Promise<boolean> {
  const body = (ctx.request.body ?? {}) as { debugCode?: string }
  const expected = process.env.TEXAS_RUNTIME_DEBUG_CODE
  if (
    process.env.NODE_ENV !== 'production' &&
    typeof expected === 'string' &&
    expected.length > 0 &&
    body.debugCode === expected
  ) {
    return true
  }
  return (await assertWebAdmin(ctx)) != null
}

/**
 * 实时对照：DB RoomMember vs 本进程 Core 座位环 / leavePending。
 * Body: `{ roomId, debugCode? }`
 */
router.post(roomOpsWebApi('/runtime-debug'), async (ctx) => {
  if (!(await assertRoomRuntimeDebugAccess(ctx))) return

  const { roomId } = (ctx.request.body ?? {}) as { roomId?: number }
  if (roomId == null || !Number.isInteger(roomId) || roomId <= 0) {
    response.error(ctx, HTTP_STATUS.BAD_REQUEST, 'roomId 参数错误')
    return
  }

  const payload = await buildRoomRuntimeDebugPayload(roomId)
  if (!payload.db.exists) {
    response.error(ctx, HTTP_STATUS.NOT_FOUND, '房间不存在')
    return
  }
  response.success(ctx, payload)
})

/**
 * 事后排障：从 MatchDomainEvent 还原离场/RolesAssigned 座位变化（不依赖 runtime）。
 * Body: `{ roomId, matchLimit?, debugCode? }`
 */
router.post(roomOpsWebApi('/leave-forensics'), async (ctx) => {
  if (!(await assertRoomRuntimeDebugAccess(ctx))) return

  const { roomId, matchLimit } = (ctx.request.body ?? {}) as {
    roomId?: number
    matchLimit?: number
  }
  if (roomId == null || !Number.isInteger(roomId) || roomId <= 0) {
    response.error(ctx, HTTP_STATUS.BAD_REQUEST, 'roomId 参数错误')
    return
  }

  const payload = await buildRoomLeaveForensicsPayload(roomId, {
    matchLimit:
      matchLimit != null && Number.isInteger(matchLimit)
        ? matchLimit
        : undefined
  })
  if (!payload) {
    response.error(ctx, HTTP_STATUS.NOT_FOUND, '房间不存在')
    return
  }
  response.success(ctx, payload)
})

router.post(dashboardWebApi('/summary'), async (ctx) => {
  if ((await assertWebAdmin(ctx)) == null) return

  const payload = await buildDashboardSummary()
  response.success(ctx, payload)
})

/** 客户端卡背 / 牌桌使用次数聚合（管理员） */
router.post(assetUsageWebApi('/summary'), async (ctx) => {
  if ((await assertWebAdmin(ctx)) == null) return

  const { time, assetType } = (ctx.request.body ?? {}) as {
    time?: [string, string]
    assetType?: 'poker_back' | 'table_bg' | 'all'
  }

  const where: Prisma.AssetUsageEventWhereInput = {}
  if (time?.length === 2) {
    const from = new Date(time[0])
    const to = new Date(time[1])
    if (
      Number.isNaN(from.getTime()) ||
      Number.isNaN(to.getTime()) ||
      from.getTime() > to.getTime()
    ) {
      response.error(ctx, HTTP_STATUS.BAD_REQUEST, 'time 参数无效')
      return
    }
    where.serverTs = {
      gte: from,
      lte: to
    }
  }
  if (assetType === 'poker_back' || assetType === 'table_bg') {
    where.assetType = assetType
  }

  const grouped = await assetUsageEvent.groupBy({
    by: ['assetType', 'assetId'],
    where,
    _count: { id: true },
    orderBy: { _count: { id: 'desc' } },
    take: 300
  })

  const total = await assetUsageEvent.count({ where })

  response.success(ctx, {
    total,
    rows: grouped.map((r) => ({
      assetType: r.assetType,
      assetId: r.assetId,
      count: r._count.id
    }))
  })
})
