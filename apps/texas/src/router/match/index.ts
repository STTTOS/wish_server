import type { WithPaginationReq } from '../interface'

import dayjs from 'dayjs'

import './web'
import router from '../instance'
import combinePath from '../../utils/combinePath'
import { ERROR_CODE } from '../../constants/errorCodes'
import response, { withList } from '../../utils/response'
import { timeFormat, apiPrefixClient } from '../../config'
import {
  match,
  roomMember,
  userRoomStat,
  playerMatchRecord
} from '../../models'
import {
  gameRuntimeRegistry,
  getCurrentMatchIdWithFallback
} from '../game/services/runtimeKit'

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
    userId,
    match: {
      // 过滤掉未结束的对局
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
      select: {
        match: {
          include: {
            room: true
          }
        },
        id: true,
        handPokes: true,
        wager: true,
        isAllIn: true,
        isFold: true,
        totalBetAmount: true
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
    .map(({ match, ...restRecord }) => {
      const {
        id: matchId,
        room: { code: roomCode, initialChips },
        startedAt,
        endedAt,
        ...restMatch
      } = match
      return {
        ...restRecord,
        ...restMatch,
        matchId,
        roomCode,
        initialChips,
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
    where: { userId },
    select: {
      isAllIn: true,
      isFold: true,
      rankCategory: true,
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

    if (r.rankCategory === 'z') royalFlushCount += 1
    if (r.rankCategory === 'y') straightFlushCount += 1
    if (r.rankCategory === 'x') fourOfKindCount += 1

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
    response.error(ctx, ERROR_CODE.BAD_REQUEST, '参数异常：需要 matchId')
    return
  }

  const matchInfo = await match.findUnique({
    where: { id: matchId, endedAt: { not: null } },
    include: {
      room: true,
      playerMatchRecords: {
        select: {
          user: {
            select: {
              id: true,
              avatarUrl: true,
              avatarKey: true,
              name: true
            }
          },
          id: true,
          role: true,
          isFold: true,
          wager: true,
          isAllIn: true,
          handPokes: true,
          rankStrength: true,
          rankCategory: true,
          totalBetAmount: true
        }
      },
      records: {
        select: {
          user: {
            select: {
              id: true,
              avatarUrl: true,
              avatarKey: true,
              name: true
            }
          },
          id: true,
          actionType: true,
          amount: true,
          stage: true,
          createdAt: true
        },

        orderBy: {
          createdAt: 'asc'
        }
      }
    }
  })
  if (!matchInfo) {
    response.error(ctx, ERROR_CODE.COMMON_FAIL, '对局不存在')
    return
  }

  const participated = await playerMatchRecord.findFirst({
    where: {
      matchId,
      userId
    }
  })
  if (!participated) {
    response.error(ctx, ERROR_CODE.FORBIDDEN, '无权查看该对局')
    return
  }

  type PlayerRecordWithSortIndex =
    (typeof matchInfo.playerMatchRecords)[number] & {
      sortIndex: number
    }

  const {
    room: { code: roomCode, id: roomId, initialChips },
    endedAt,
    records,
    startedAt,
    playerMatchRecords,
    ...restMatchInfo
  } = matchInfo
  // 玩家结算记录
  const settleRecords = playerMatchRecords
    //根据牌力排序, 弃牌在后
    .sort((a, b) => {
      if (a.isFold !== b.isFold) return a.isFold ? 1 : -1
      return a.rankStrength - b.rankStrength
    })
    // 根据牌力设置 sortIndex
    .reduce<PlayerRecordWithSortIndex[]>((acc, cur, index) => {
      const lastOne = acc[index - 1]
      let sortIndex: number
      if (!lastOne) {
        sortIndex = 1
      } else if (lastOne.rankStrength === cur.rankStrength) {
        sortIndex = lastOne.sortIndex
      } else {
        sortIndex = lastOne.sortIndex + 1
      }
      return [...acc, { ...cur, sortIndex }]
    }, [])
    // 格式化字段
    .map(
      ({
        handPokes,
        isFold,
        sortIndex: rank,
        user: { id: userId, ...user },
        rankCategory,
        rankStrength,
        ...rest
      }) => ({
        ...user,
        ...rest,
        rank,
        userId,
        isFold,
        handPokes: isFold ? [] : handPokes,
        rankCategory: isFold ? undefined : rankCategory,
        rankStrength: isFold ? 0 : rankStrength
      })
    )

  const actionRecords = records.map(
    ({ user: { id: userId, ...user }, createdAt, ...record }) => ({
      userId,
      ...user,
      ...record,
      createdAt: dayjs(createdAt).format(timeFormat)
    })
  )
  response.success(ctx, {
    ...restMatchInfo,
    roomId,
    roomCode,
    initialChips,
    memberCount: playerMatchRecords.length,
    startedAt: dayjs(startedAt).format(timeFormat),
    endedAt: dayjs(endedAt).format(timeFormat),
    settleRecords,
    actionRecords
  })
})

/**
 * 获取当前对局状态（用于重连恢复）
 */
router.post(matchApi('/currentState'), async (ctx) => {
  const userId = ctx.state.user!.id
  const membership = await roomMember.findFirst({
    where: { userId, room: { deletedAt: null } },
    select: { roomId: true }
  })
  const roomId = membership?.roomId
  if (!roomId) {
    response.error(ctx, 2000, '当前不在对局房间中')
    return
  }

  const texas = gameRuntimeRegistry.getTexas(String(roomId))
  if (!texas) {
    response.error(ctx, 2000, '对局不存在')
    return
  }

  const currentMatchId = await getCurrentMatchIdWithFallback(roomId)

  const playersOnSeat = texas.room
    .getPlayersBySeatStatus('on-set')
    .map((player) => ({
      role: player.getRole(),
      action: player.getAction(),
      userInfo: player.getUserInfo(),
      currentStageTotalAmount: player.currentStageTotalAmount,
      totalBetAmount: player.totalBetAmount,
      rankCategory: player.rankSignature?.[0]
    }))
  const playersOnWatch = texas.room
    .getPlayersBySeatStatus('hang')
    .map((player) => ({
      userInfo: player.getUserInfo()
    }))

  const activePlayer = texas.controller.activePlayer
  const activePlayerInfo = {
    userInfo: activePlayer?.getUserInfo(),
    remainThinkTime: activePlayer?.getRemainThinkTime()
  }

  response.success(ctx, {
    matchId: currentMatchId,
    roomId: Number(roomId),
    status: texas.controller.status,
    stage: texas.controller.stage,
    pool: texas.pool.totalAmount,
    commonPokes: texas.dealer.deck.getPokes().commonPokes,
    activePlayerInfo,
    playersOnSeat,
    playersOnWatch
  })
})
