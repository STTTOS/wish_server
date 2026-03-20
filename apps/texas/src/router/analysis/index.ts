import dayjs from 'dayjs'
import { Prisma } from '@prisma/texas-client'

import router from '../instance'
import formatTime from '../../utils/formatTime'
import combinePath from '../../utils/combinePath'
import { timeFormat, apiPrefixWeb } from '../../config'
import response, { withList } from '../../utils/response'
import { match, betRecord, matchError, playerMatchRecord } from '../../models'

const analysisApi = combinePath(apiPrefixWeb)('/analysis')
router.post(analysisApi('/match/list'), async (ctx) => {
  const { current: skip, pageSize: take, time } = ctx.request.body
  if (!skip || !take) {
    response.error(ctx, 400, '分页参数错误')
    return
  }
  const where: Prisma.MatchWhereInput = {}
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
      MatchError: {
        select: {
          id: true
        }
      }
    },
    orderBy: {
      startedAt: 'desc'
    }
  })
  response.success(
    ctx,
    withList(
      list.map(({ MatchError, ...rest }) => {
        return {
          ...rest,
          memberCount: rest.playerMatchRecords.length,
          startedAt: dayjs(rest.startedAt).format(timeFormat),
          endAt: dayjs(rest.endedAt).format(timeFormat),
          errorCount: MatchError.length
        }
      }),
      total
    )
  )
})

router.post(analysisApi('/match/detail/:id'), async (ctx) => {
  const id = Number(ctx.params.id)
  if (isNaN(id)) {
    response.error(ctx, 400, '参数错误')
    return
  }

  const winners = await playerMatchRecord.findMany({
    where: {
      matchId: id,
      wager: {
        gt: 0
      }
    },
    select: {
      userId: true
    }
  })
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
        }
      },
      playerMatchRecords: {
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
  response.success(ctx, {
    ...detail,
    startedAt: formatTime(detail.startedAt),
    endedAt: formatTime(detail.endedAt),
    matchStageTimeRecord: detail.matchStageTimeRecord?.map((record) => {
      return {
        ...record,
        endAt: formatTime(record.endAt),
        startAt: formatTime(record.startAt)
      }
    }),
    playerHands: detail.playerMatchRecords.map((playerHand) => {
      return {
        ...playerHand,
        win: !!winners.find((winner) => winner.userId === playerHand.userId)
      }
    })
  })
})

router.post(analysisApi('/match/error/:id'), async (ctx) => {
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
router.post(analysisApi('/records/:matchId'), async (ctx) => {
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

router.post(analysisApi('/players/:matchId'), async (ctx) => {
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
