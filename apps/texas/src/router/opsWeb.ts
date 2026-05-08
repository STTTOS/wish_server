/**
 * Web 管理端：跨对局排障与房间运维（仅管理员）
 */
import type { RoomGameStatus } from '@prisma/texas-client'

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
    roomId,
    ownerId
  } = (ctx.request.body ?? {}) as {
    current?: number
    pageSize?: number
    gameStatus?: string
    roomId?: number
    ownerId?: number
  }
  if (!page || !take) {
    response.error(ctx, HTTP_STATUS.BAD_REQUEST, '分页参数错误')
    return
  }

  const where: Prisma.RoomWhereInput = { deletedAt: null }
  if (roomId != null && Number.isInteger(roomId) && roomId > 0) {
    where.id = roomId
  }
  if (ownerId != null && Number.isInteger(ownerId) && ownerId > 0) {
    where.ownerId = ownerId
  }
  const validStatuses: RoomGameStatus[] = [
    'waiting',
    'entering',
    'starting_hand',
    'in_hand',
    'between_hands'
  ]
  if (gameStatus && gameStatus !== 'all') {
    if (!validStatuses.includes(gameStatus as RoomGameStatus)) {
      response.error(ctx, HTTP_STATUS.BAD_REQUEST, 'gameStatus 参数异常')
      return
    }
    where.gameStatus = gameStatus as RoomGameStatus
  }

  const skip = (page - 1) * take
  const [total, rows] = await Promise.all([
    room.count({ where }),
    room.findMany({
      where,
      skip,
      take,
      orderBy: { createdAt: 'desc' },
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
        matchCount: r._count.Match
      })),
      total
    )
  )
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
