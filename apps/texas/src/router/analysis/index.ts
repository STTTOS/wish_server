import dayjs from 'dayjs'
import { Prisma } from '@prisma/texas-client'

import router from '../instance'
import combinePath from '../../utils/combinePath'
import { apiPrefix, timeFormat } from '../../config'
import response, { withList } from '../../utils/response'
import { win, match, record, playerHand } from '../../models'

const analysisApi = combinePath(apiPrefix)('/analysis')
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
      maximumType: true,
      commonPokes: true,
      playersCount: true,
      lowestBetAmount: true,
      endedAt: true,
      endStage: true
    },
    orderBy: {
      startedAt: 'desc'
    }
  })
  response.success(
    ctx,
    withList(
      list.map((item) => {
        return {
          ...item,
          startedAt: dayjs(item.startedAt).format(timeFormat),
          endAt: dayjs(item.endedAt).format(timeFormat)
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

  const winners = await win.findMany({
    where: {
      matchId: id
    }
  })
  const detail = await match.findUnique({
    where: { id },
    include: {
      records: {
        include: {
          player: true
        }
      },
      playerHands: {
        include: {
          player: true
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
    startedAt: dayjs(detail.startedAt).format(timeFormat),
    endedAt: detail.endedAt && dayjs(detail.endedAt).format(timeFormat),
    playerHands: detail.playerHands.map((playerHand) => {
      return {
        ...playerHand,
        win: winners.find((winner) => winner.playerId === playerHand.playerId)
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
  const list = await record.findMany({
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
  const list = await playerHand.findMany({
    where: {
      matchId
    },
    include: {
      player: true
    }
  })
  response.success(ctx, { list })
})
