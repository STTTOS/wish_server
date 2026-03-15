import type { WithPaginationReq } from '../interface'

import dayjs from 'dayjs'
import { comparePresentation } from 'texas-poker-core'

import router from '../instance'
import { logger } from '../../logger'
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
    match: {
      endedAt: { not: null }
    },
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

  const listForResponse = records
    .sort((a, b) => a.match.startedAt.getTime() - b.match.endedAt!.getTime())
    .map((r) => {
      const { id, wager, presentation, hand } = r

      const m = r.match!
      const {
        id: matchId,
        roomId,
        room,
        startedAt,
        endedAt,
        endStage,
        commonPokes,
        lowestBetAmount
      } = m
      const { code: roomCode, initialChips } = room
      logger.info('hand', typeof hand, typeof commonPokes)
      return {
        id,
        roomId,
        matchId,
        roomCode,
        wager,
        lowestBetAmount,
        initialChips,
        endStage,
        handPokes: hand,
        commonPokes,
        handType: (presentation as string)[0],
        startedAt: dayjs(startedAt).format(timeFormat),
        endedAt: endedAt ? dayjs(endedAt).format(timeFormat) : null
      }
    })

  response.success(ctx, withList(listForResponse, total))
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
 * 战绩总览：当前用户总对局数、allIn 次数、弃牌次数
 */
router.post(matchApi('/overview'), async (ctx) => {
  const userId = ctx.state.user!.id

  const records = await playerMatchRecord.findMany({
    where: { playerId: userId },
    select: {
      isAllIn: true,
      isFold: true,
      presentation: true,
      wager: true,
      totalBetAmount: true
    }
  })

  const totalMatches = records.length

  let allInCount = 0
  let foldCount = 0
  let royalFlushCount = 0
  let straightFlushCount = 0
  let fourOfKindCount = 0
  let winMatchCount = 0
  let loseMatchCount = 0
  let tieMatchCount = 0
  let totalBetAmount = 0
  let totalWager = 0

  records.forEach((r) => {
    if (r.isAllIn) allInCount += 1
    if (r.isFold) foldCount += 1

    if (r.presentation === 'z') royalFlushCount += 1
    if (r.presentation === 'y') straightFlushCount += 1
    if (r.presentation === 'x') fourOfKindCount += 1

    const wager = r.wager ?? 0
    if (wager > 0) winMatchCount += 1
    else if (wager < 0) loseMatchCount += 1
    else tieMatchCount += 1

    totalBetAmount += r.totalBetAmount ?? 0
    totalWager += wager
  })

  response.success(ctx, {
    totalMatches,
    allInCount,
    foldCount,
    royalFlushCount,
    straightFlushCount,
    fourOfKindCount,
    winMatchCount,
    loseMatchCount,
    tieMatchCount,
    totalBetAmount,
    totalWager
  })
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

  const matchInfo = await match.findUnique({
    where: { id: matchId, endedAt: { not: null } },
    include: {
      room: true,
      playerMatchRecords: {
        include: {
          player: {
            select: {
              id: true,
              avatar: true,
              name: true
            }
          }
        }
      },
      records: {
        select: {
          player: {
            select: {
              id: true,
              avatar: true,
              name: true
            }
          },
          id: true,
          action: true,
          amount: true,
          stage: true,
          createdAt: true
        },

        orderBy: {
          createdAt: 'desc'
        }
      }
    }
  })
  if (!matchInfo) {
    response.error(ctx, 2000, '对局不存在')
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

  type PlayerRecordWithSortIndex =
    (typeof matchInfo.playerMatchRecords)[number] & {
      sortIndex: number
    }

  const sortedPlayerRecords = matchInfo.playerMatchRecords
    //根据牌力排序, 弃牌在后
    .sort((a, b) => {
      if (a.isFold !== b.isFold) return a.isFold ? 1 : -1
      return comparePresentation(String(b.presentation), String(a.presentation))
    })
    // 根据牌力设置 sortIndex
    .reduce<PlayerRecordWithSortIndex[]>((acc, cur, index) => {
      const lastOne = acc[index - 1]
      let sortIndex: number
      if (!lastOne) {
        sortIndex = 1
      } else if (String(lastOne.presentation) === String(cur.presentation)) {
        sortIndex = lastOne.sortIndex
      } else {
        sortIndex = lastOne.sortIndex + 1
      }
      return [...acc, { ...cur, sortIndex }]
    }, [])
    // 格式化字段
    .map(
      ({
        hand,
        isFold,
        sortIndex: rank,
        player: { id: userId, ...player },
        ...rest
      }) => ({
        ...player,
        ...rest,
        rank,
        userId,
        isFold,
        hand: isFold ? [] : hand
      })
    )

  const {
    id,
    room,
    endedAt,
    maxPokes,
    records,
    startedAt,
    totalBetAmount,
    maxPresentation,
    lowestBetAmount
  } = matchInfo
  const betRecords = records.map(
    ({ player: { id: userId, ...player }, createdAt, ...record }) => ({
      userId,
      ...player,
      ...record,
      createdAt: dayjs(createdAt).format(timeFormat)
    })
  )
  response.success(ctx, {
    id,
    roomCode: room.code,
    roomId: room.id,
    startedAt: dayjs(startedAt).format(timeFormat),
    endedAt: dayjs(endedAt).format(timeFormat),
    maxPokes,
    lowestBetAmount,
    totalBetAmount,
    maxPresentation,
    players: sortedPlayerRecords,
    records: betRecords
  })
})
