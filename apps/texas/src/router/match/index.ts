import type { WithPaginationReq } from '../interface'

import dayjs from 'dayjs'
import {
  Poke,
  comparePresentation,
  getBestPokesPresentation
} from 'texas-poker-core'

import router from '../instance'
import combinePath from '../../utils/combinePath'
import response, { withList } from '../../utils/response'
import { timeFormat, apiPrefixClient } from '../../config'
import { match, userRoomStat, playerMatchRecord } from '../../models'

const matchApi = combinePath(apiPrefixClient)('/match')

/**
 * 查询当前用户的对局记录（分页）
 */
router.post(matchApi('/list'), async (ctx) => {
  const userId = ctx.state.user!.id
  const {
    current = 1,
    pageSize = 10,
    roomId
  }: WithPaginationReq & { roomId?: number } = ctx.request.body ?? {}

  const skip = (current - 1) * pageSize
  const take = pageSize

  const where = {
    playerId: userId,
    ...(roomId ? { match: { roomId } } : {})
  }

  const [total, records] = await Promise.all([
    playerMatchRecord.count({
      where
    }),
    playerMatchRecord.findMany({
      where,
      include: {
        match: {
          include: {
            room: true
          }
        }
      },
      orderBy: {
        match: {
          startedAt: 'desc'
        }
      },
      skip,
      take
    })
  ])

  const list = records.map((record) => {
    const m = record.match!
    return {
      id: record.id,
      matchId: m.id,
      roomId: m.roomId,
      // 筹码增减
      wager: record.wager,
      roomCode: m.room.code,
      totalBetAmount: m.totalBetAmount,
      // 最大牌型
      presentation: record.presentation,
      lowestBetAmount: m.lowestBetAmount,
      startedAt: dayjs(m.startedAt).format(timeFormat),
      endedAt: m.endedAt ? dayjs(m.endedAt).format(timeFormat) : null
    }
  })

  response.success(ctx, withList(list, total))
})

/**
 * 查询当前用户参与过的所有房间列表（按房间归类）
 */
router.post(matchApi('/rooms'), async (ctx) => {
  const userId = ctx.state.user!.id

  const stats = await userRoomStat.findMany({
    where: {
      userId
    },
    include: {
      room: true
    }
  })

  const list = stats
    .sort((a, b) => b.lastMatchAt.getTime() - a.lastMatchAt.getTime())
    .map((stat) => ({
      roomId: stat.roomId,
      roomCode: stat.room.code,
      lowestBetAmount: stat.room.lowestBetAmount,
      thinkingTime: stat.room.thinkingTime,
      isPrivate: stat.room.isPrivate,
      lastMatchAt: dayjs(stat.lastMatchAt).format(timeFormat),
      matchCount: stat.matchCount,
      totalWager: stat.totalWager,
      totalBetAmount: stat.totalBetAmount
    }))

  response.success(ctx, list)
})

/**
 * 查询对局详情（当前用户必须参与过该对局）
 */
router.post(matchApi('/detail'), async (ctx) => {
  const userId = ctx.state.user!.id
  const { matchId }: { matchId?: number } = ctx.request.body ?? {}

  if (!matchId) {
    response.error(ctx, 400, '参数异常：需要 matchId')
    return
  }

  const participated = await playerMatchRecord.findFirst({
    where: {
      matchId,
      playerId: userId
    }
  })
  if (!participated) {
    response.error(ctx, 403, '无权查看该对局')
    return
  }

  const matchInfo = await match.findUnique({
    where: { id: matchId },
    include: {
      room: true,
      playerMatchRecords: {
        include: {
          player: true
        }
      },
      records: {
        include: {
          player: true
        }
      }
    }
  })

  if (!matchInfo) {
    response.error(ctx, 2000, '对局不存在')
    return
  }
  const commonPokes = matchInfo.commonPokes as Poke[]

  const sortedPlayerRecords = [...matchInfo.playerMatchRecords].sort((a, b) => {
    // 先按是否弃牌：未弃牌在前
    if (a.isFold !== b.isFold) {
      return a.isFold ? 1 : -1
    }
    // 比较两个玩家的最大牌型
    return comparePresentation(
      getBestPokesPresentation([a.hand as Poke[]], commonPokes),
      getBestPokesPresentation([b.hand as Poke[]], commonPokes)
    )
  })

  response.success(ctx, {
    id: matchInfo.id,
    room: {
      id: matchInfo.room.id,
      code: matchInfo.room.code
    },
    startedAt: dayjs(matchInfo.startedAt).format(timeFormat),
    endedAt: matchInfo.endedAt
      ? dayjs(matchInfo.endedAt).format(timeFormat)
      : null,
    lowestBetAmount: matchInfo.lowestBetAmount,
    totalBetAmount: matchInfo.totalBetAmount,
    maximumType: matchInfo.maximumType,
    maximumPokes: matchInfo.maximumPokes,
    players: sortedPlayerRecords.map((ph) => ({
      userId: ph.playerId,
      name: ph.player.name,
      avatar: ph.player.avatar,
      role: ph.role,
      hand: ph.isFold ? [] : ph.hand,
      wager: ph.wager,
      presentation: ph.presentation,
      totalBetAmount: ph.totalBetAmount,
      isFold: ph.isFold,
      isAllIn: ph.isAllIn
    })),
    records: matchInfo.records.map((r) => ({
      userId: r.playerId,
      name: r.player.name,
      action: r.action,
      amount: r.amount,
      stage: r.stage,
      createdAt: dayjs(r.createdAt).format(timeFormat)
    }))
  })
})
