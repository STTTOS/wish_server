/**
 * Web 管理端：跨对局排障与房间运维（仅管理员）
 */
import type { ParameterizedContext } from 'koa'
import type { RoomGameStatus } from '@prisma/texas-client'

import dayjs from 'dayjs'
import { Prisma } from '@prisma/texas-client'

import { apiPrefixWeb } from '../config'
import formatTime from '../utils/formatTime'
import combinePath from '../utils/combinePath'
import { HTTP_STATUS } from '../constants/httpStatus'
import router, { type DefaultState } from './instance'
import response, { withList } from '../utils/response'
import { user, room, match, engineFatalIncident } from '../models'

const engineFatalWebApi = combinePath(apiPrefixWeb)('/engine-fatal')
const roomOpsWebApi = combinePath(apiPrefixWeb)('/room-ops')
const dashboardWebApi = combinePath(apiPrefixWeb)('/dashboard')

type KoaCtx = ParameterizedContext<DefaultState>

async function assertWebAdmin(ctx: KoaCtx): Promise<number | null> {
  const userId = ctx.state.user?.id
  if (!userId) {
    response.error(ctx, HTTP_STATUS.UNAUTHORIZED, '身份凭证无效, 请重新登陆')
    return null
  }
  const login = await user.findUnique({
    where: { id: userId },
    select: { isAdmin: true }
  })
  if (!login?.isAdmin) {
    response.error(ctx, HTTP_STATUS.FORBIDDEN, '无权限')
    return null
  }
  return userId
}

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
  if (matchId != null && Number.isFinite(matchId)) {
    where.matchId = matchId
  }
  if (roomId != null && Number.isFinite(roomId)) {
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
  if (roomId != null && Number.isFinite(roomId)) {
    where.id = roomId
  }
  if (ownerId != null && Number.isFinite(ownerId)) {
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

  const since = dayjs().subtract(7, 'day').startOf('day').toDate()
  const todayStart = dayjs().startOf('day').toDate()

  const [
    matchesEndedLast7d,
    engineFatalsLast7d,
    roomsInPlay,
    roomsTotal,
    matchesEndedToday,
    engineFatalsToday
  ] = await Promise.all([
    match.count({
      where: { endedAt: { gte: since } }
    }),
    engineFatalIncident.count({
      where: { createdAt: { gte: since } }
    }),
    room.count({
      where: {
        deletedAt: null,
        gameStatus: {
          in: ['entering', 'starting_hand', 'in_hand', 'between_hands']
        }
      }
    }),
    room.count({ where: { deletedAt: null } }),
    match.count({
      where: { endedAt: { gte: todayStart } }
    }),
    engineFatalIncident.count({
      where: { createdAt: { gte: todayStart } }
    })
  ])

  response.success(ctx, {
    rangeStart: formatTime(since),
    matchesEndedLast7d,
    engineFatalsLast7d,
    roomsInPlay,
    roomsTotal,
    matchesEndedToday,
    engineFatalsToday
  })
})
