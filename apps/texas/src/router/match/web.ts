import dayjs from 'dayjs'
import { Prisma } from '@prisma/texas-client'

import router from '../instance'
import { logger } from '../../logger'
import formatTime from '../../utils/formatTime'
import combinePath from '../../utils/combinePath'
import { timeFormat, apiPrefixWeb } from '../../config'
import response, { withList } from '../../utils/response'
import {
  user,
  match,
  betRecord,
  matchError,
  playerMatchRecord
} from '../../models'

const matchWebApi = combinePath(apiPrefixWeb)('/match')

router.post(matchWebApi('/list'), async (ctx) => {
  const userId = ctx.state.user?.id
  const { current: skip, pageSize: take, time } = ctx.request.body
  if (!userId) {
    response.error(ctx, 401, '身份凭证无效, 请重新登陆')
    return
  }
  if (!skip || !take) {
    response.error(ctx, 400, '分页参数错误')
    return
  }

  const loginUser = await user.findUnique({
    where: { id: userId },
    select: { isAdmin: true }
  })
  if (!loginUser) {
    response.error(ctx, 2000, '用户不存在')
    return
  }

  const where: Prisma.MatchWhereInput = {}
  if (!loginUser.isAdmin) {
    where.playerMatchRecords = {
      some: {
        userId
      }
    }
  }
  logger.info('where', JSON.stringify(where))
  if (time) {
    const [start, end] = time
    where.startedAt = {
      gte: new Date(start),
      lte: new Date(end)
    }
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
      commonPokes: true,
      lowestBetAmount: true,
      endedAt: true,
      endStage: true,
      playerMatchRecords: {
        select: {
          id: true
        }
      },
      matchError: {
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
  response.success(
    ctx,
    withList(
      list.map(({ matchError, playerMatchRecords, ...rest }) => {
        const { code, id, initialChips } = rest.room

        return {
          ...rest,
          roomId: id,
          initialChips,
          roomCode: code,
          memberCount: playerMatchRecords.length,
          startedAt: dayjs(rest.startedAt).format(timeFormat),
          endedAt: dayjs(rest.endedAt).format(timeFormat),
          errorCount: matchError.length
        }
      }),
      total
    )
  )
})

router.post(matchWebApi('/detail/:id'), async (ctx) => {
  const userId = ctx.state.user?.id
  const id = Number(ctx.params.id)
  if (!userId) {
    response.error(ctx, 401, '身份凭证无效, 请重新登陆')
    return
  }
  if (isNaN(id)) {
    response.error(ctx, 400, '参数错误')
    return
  }
  const loginUser = await user.findUnique({
    where: { id: userId },
    select: { isAdmin: true }
  })
  if (!loginUser) {
    response.error(ctx, 2000, '用户不存在')
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
              avatarKey: true
            }
          }
        },
        orderBy: {
          createdAt: 'asc'
        }
      },
      playerMatchRecords: {
        orderBy: [{ isFold: 'asc' }, { rankStrength: 'desc' }],
        include: {
          user: {
            select: {
              id: true,
              name: true,
              avatarUrl: true,
              avatarKey: true
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
      }
    }
  })
  if (!detail) {
    response.error(ctx, 404, '对局不存在')
    return
  }
  if (!loginUser.isAdmin) {
    const participated = detail.playerMatchRecords.some(
      (record) => record.userId === userId
    )
    if (!participated) {
      response.error(ctx, 403, '无权限查看该对局')
      return
    }
  }
  const { records, playerMatchRecords, matchStageTimeRecord, ...restDetail } =
    detail
  response.success(ctx, {
    ...restDetail,
    startedAt: formatTime(detail.startedAt),
    endedAt: formatTime(detail.endedAt),
    stageRecords: matchStageTimeRecord.map((record) => {
      return {
        ...record,
        endAt: formatTime(record.endAt),
        startAt: formatTime(record.startAt)
      }
    }),
    settleRecords: playerMatchRecords.map(
      ({ user: { id, ...restUser }, isFold, handPokes, ...restRecord }) => {
        return {
          ...restUser,
          ...restRecord,
          userId: id,
          isFold,
          handPokes: isFold ? [] : handPokes
        }
      }
    ),
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
    response.error(ctx, 400, '参数错误')
    return
  }
  const list = await matchError.findMany({
    where: {
      matchId: id
    }
  })
  response.success(ctx, {
    list: list.map((item) => {
      return {
        ...item,
        createdAt: formatTime(item.createdAt)
      }
    })
  })
})

router.post(matchWebApi('/records/:matchId'), async (ctx) => {
  const matchId = Number(ctx.params.matchId)

  if (isNaN(matchId)) {
    response.error(ctx, 400, '参数错误')
    return
  }
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
    response.error(ctx, 400, '参数错误')
    return
  }
  const list = await playerMatchRecord.findMany({
    where: {
      matchId
    },
    include: {
      user: true
    }
  })
  response.success(ctx, { list })
})
