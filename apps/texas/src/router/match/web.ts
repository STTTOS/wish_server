import type { ParameterizedContext } from 'koa'

import { Prisma } from '@prisma/texas-client'

import router from '../instance'
import { logger } from '../../logger'
import { apiPrefixWeb } from '../../config'
import formatTime from '../../utils/formatTime'
import combinePath from '../../utils/combinePath'
import { ROOM_TABLE_TYPES } from '../../constants/game'
import { HTTP_STATUS } from '../../constants/httpStatus'
import response, { withList } from '../../utils/response'
import { projectSettleRecordsForMatchDetail } from './matchSettleVisibility'
import { loadMatchCompositeReadModelFromDbTape } from '../game/services/matchReplayReadModel'
import {
  user,
  match,
  betRecord,
  playerMatchRecord,
  engineFatalIncident
} from '../../models'

const matchWebApi = combinePath(apiPrefixWeb)('/match')

type WebCtx = ParameterizedContext

async function assertWebUser(ctx: WebCtx): Promise<number | null> {
  const userId = ctx.state.user?.id
  if (!userId) {
    response.error(ctx, HTTP_STATUS.UNAUTHORIZED, '身份凭证无效, 请重新登陆')
    return null
  }
  return userId
}

/** 管理员或本局参与者可查看对局敏感数据（错误、原始记录等） */
async function assertMatchSensitiveAccess(
  ctx: WebCtx,
  matchId: number
): Promise<{ userId: number; isAdmin: boolean } | null> {
  const userId = await assertWebUser(ctx)
  if (userId == null) return null

  const loginUser = await user.findUnique({
    where: { id: userId },
    select: { isAdmin: true }
  })
  if (!loginUser) {
    response.error(ctx, HTTP_STATUS.NOT_FOUND, '用户不存在')
    return null
  }
  if (loginUser.isAdmin) {
    return { userId, isAdmin: true }
  }
  const participated = await playerMatchRecord.findUnique({
    where: { matchId_userId: { matchId, userId } }
  })
  if (!participated) {
    response.error(ctx, HTTP_STATUS.FORBIDDEN, '无权限查看该对局')
    return null
  }
  return { userId, isAdmin: false }
}

router.post(matchWebApi('/list'), async (ctx) => {
  const userId = await assertWebUser(ctx)
  if (userId == null) return

  const { current: skip, pageSize: take, time, type } = ctx.request.body
  if (!skip || !take) {
    response.error(ctx, HTTP_STATUS.BAD_REQUEST, '分页参数错误')
    return
  }

  const loginUser = await user.findUnique({
    where: { id: userId },
    select: { isAdmin: true }
  })
  if (!loginUser) {
    response.error(ctx, HTTP_STATUS.NOT_FOUND, '用户不存在')
    return
  }

  const where: Prisma.MatchWhereInput = {}
  if (
    type &&
    type !== 'all' &&
    !(ROOM_TABLE_TYPES as readonly string[]).includes(type)
  ) {
    response.error(ctx, HTTP_STATUS.BAD_REQUEST, 'type 参数异常')
    return
  }
  if (!loginUser.isAdmin) {
    where.playerMatchRecords = {
      some: {
        userId
      }
    }
  }
  if (time) {
    const [start, end] = time
    where.startedAt = {
      gte: new Date(start),
      lte: new Date(end)
    }
  }
  if (type && type !== 'all') {
    where.room = { is: { tableType: type } }
  }

  const total = await match.count({ where })
  const list = await match.findMany({
    take,
    skip: (skip - 1) * take,
    where,
    select: {
      id: true,
      startedAt: true,
      bestRankCategory: true,
      bestRankSignature: true,
      commonPokes: true,
      lowestBetAmount: true,
      endedAt: true,
      boardThroughStage: true,
      totalBetAmount: true,
      playerMatchRecords: {
        select: {
          id: true
        }
      },
      room: true
    },
    orderBy: {
      startedAt: 'desc'
    }
  })
  const matchIds = list.map((m) => m.id)
  const fatalByMatchId =
    matchIds.length === 0
      ? new Map<number, number>()
      : new Map(
          (
            await engineFatalIncident.groupBy({
              by: ['matchId'],
              where: { matchId: { in: matchIds } },
              _count: { _all: true }
            })
          ).map((r) => [r.matchId, r._count._all])
        )
  response.success(
    ctx,
    withList(
      list.map(({ playerMatchRecords, ...rest }) => {
        const {
          activeCode,
          id,
          initialChips,
          tableType,
          sevenTwoBonusEnabled
        } = rest.room

        return {
          ...rest,
          roomId: id,
          initialChips,
          tableType,
          sevenTwoBonusEnabled,
          roomCode: activeCode ?? '',
          memberCount: playerMatchRecords.length,
          startedAt: formatTime(rest.startedAt),
          endedAt: formatTime(rest.endedAt),
          errorCount: fatalByMatchId.get(rest.id) ?? 0
        }
      }),
      total
    )
  )
})

router.post(matchWebApi('/detail/:id'), async (ctx) => {
  const userId = await assertWebUser(ctx)
  if (userId == null) return

  const id = Number(ctx.params.id)
  if (isNaN(id)) {
    response.error(ctx, HTTP_STATUS.BAD_REQUEST, '参数错误')
    return
  }
  const loginUser = await user.findUnique({
    where: { id: userId },
    select: { isAdmin: true }
  })
  if (!loginUser) {
    response.error(ctx, HTTP_STATUS.NOT_FOUND, '用户不存在')
    return
  }

  const detail = await match.findUnique({
    where: { id },
    include: {
      records: {
        include: {
          user: {
            select: {
              id: true,
              name: true,
              avatarUrl: true,
              avatarKey: true,
              pokerBackgroundKey: true
            }
          }
        },
        orderBy: {
          createdAt: 'asc'
        }
      },
      playerMatchRecords: {
        include: {
          user: {
            select: {
              id: true,
              name: true,
              avatarUrl: true,
              avatarKey: true,
              pokerBackgroundKey: true
            }
          }
        }
      },
      matchStageTimeRecord: {
        select: {
          endAt: true,
          startAt: true,
          stage: true
        }
      },
      room: {
        select: {
          tableType: true,
          sevenTwoBonusEnabled: true
        }
      }
    }
  })
  if (!detail) {
    response.error(ctx, HTTP_STATUS.NOT_FOUND, '对局不存在')
    return
  }
  if (!loginUser.isAdmin) {
    const participated = detail.playerMatchRecords.some(
      (record) => record.userId === userId
    )
    if (!participated) {
      response.error(ctx, HTTP_STATUS.FORBIDDEN, '无权限查看该对局')
      return
    }
  }
  const {
    records,
    playerMatchRecords,
    matchStageTimeRecord,
    room,
    ...restDetail
  } = detail
  response.success(ctx, {
    ...restDetail,
    tableType: room.tableType,
    sevenTwoBonusEnabled: room.sevenTwoBonusEnabled,
    startedAt: formatTime(detail.startedAt),
    endedAt: formatTime(detail.endedAt),
    stageRecords: matchStageTimeRecord.map((record) => {
      return {
        ...record,
        endAt: formatTime(record.endAt),
        startAt: formatTime(record.startAt)
      }
    }),
    settleRecords: projectSettleRecordsForMatchDetail(playerMatchRecords, {
      viewerUserId: userId,
      isAdmin: loginUser.isAdmin
    }),
    betRecords: records.map(({ user: { id, ...restUser }, ...restRecord }) => {
      return {
        ...restUser,
        ...restRecord,
        userId: id
      }
    })
  })
})

router.post(matchWebApi('/error/:id'), async (ctx) => {
  const id = Number(ctx.params.id)
  if (isNaN(id)) {
    response.error(ctx, HTTP_STATUS.BAD_REQUEST, '参数错误')
    return
  }
  const access = await assertMatchSensitiveAccess(ctx, id)
  if (!access) return

  const list = await engineFatalIncident.findMany({
    where: { matchId: id },
    orderBy: { createdAt: 'desc' }
  })
  response.success(ctx, {
    list: list.map((item) => ({
      id: item.id,
      roomId: item.roomId,
      matchId: item.matchId,
      message: item.message,
      payload: item.payload,
      createdAt: formatTime(item.createdAt)
    }))
  })
})

router.post(matchWebApi('/records/:matchId'), async (ctx) => {
  const matchId = Number(ctx.params.matchId)

  if (isNaN(matchId)) {
    response.error(ctx, HTTP_STATUS.BAD_REQUEST, '参数错误')
    return
  }
  const access = await assertMatchSensitiveAccess(ctx, matchId)
  if (!access) return

  const list = await betRecord.findMany({
    where: {
      matchId
    }
  })
  response.success(ctx, { list })
})

router.post(matchWebApi('/players/:matchId'), async (ctx) => {
  const matchId = Number(ctx.params.matchId)
  if (isNaN(matchId)) {
    response.error(ctx, HTTP_STATUS.BAD_REQUEST, '参数错误')
    return
  }
  const access = await assertMatchSensitiveAccess(ctx, matchId)
  if (!access) return

  const list = await playerMatchRecord.findMany({
    where: {
      matchId
    },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          avatarUrl: true,
          avatarKey: true,
          pokerBackgroundKey: true,
          balance: true,
          username: true,
          createdAt: true
        }
      }
    }
  })
  response.success(ctx, { list })
})

/** 管理员：从 DB 磁带重放并返回 Core 复合读模型（含底牌等敏感字段，勿对非管理员开放） */
router.post(matchWebApi('/replay-composite/:matchId'), async (ctx) => {
  const userId = ctx.state.user?.id
  const matchId = Number(ctx.params.matchId)
  if (!userId) {
    response.error(ctx, HTTP_STATUS.UNAUTHORIZED, '身份凭证无效, 请重新登陆')
    return
  }
  if (isNaN(matchId)) {
    response.error(ctx, HTTP_STATUS.BAD_REQUEST, '参数错误')
    return
  }
  const loginUser = await user.findUnique({
    where: { id: userId },
    select: { isAdmin: true }
  })
  if (!loginUser?.isAdmin) {
    response.error(ctx, HTTP_STATUS.FORBIDDEN, '无权限')
    return
  }
  try {
    const { tapeIssues, compositeReadModel } =
      await loadMatchCompositeReadModelFromDbTape(matchId)
    response.success(ctx, { tapeIssues, compositeReadModel })
  } catch (err) {
    logger.error('[match/replay-composite] failed', err)
    response.error(ctx, HTTP_STATUS.INTERNAL_SERVER_ERROR, '回放投影失败')
  }
})
