import type { WithPaginationReq } from '../interface'

import dayjs from 'dayjs'

import './web'
import router from '../instance'
import combinePath from '../../utils/combinePath'
import { HTTP_STATUS } from '../../constants/httpStatus'
import response, { withList } from '../../utils/response'
import { timeFormat, apiPrefixClient } from '../../config'
import {
  gameRuntimeRegistry,
  getCurrentMatchIdWithFallback
} from '../game/services/runtimeKit'
import { getScheduledPlayerTurnDeadline } from '../game/services/texasDomain/playerTurnTimeoutScheduler'
import {
  match,
  roomMember,
  userRoomStat,
  matchDomainEvent,
  playerMatchRecord
} from '../../models'
import {
  loadMatchReplayTapeForViewer,
  loadMatchCompositeReadModelFromDbTape
} from '../game/services/matchReplayReadModel'

const matchApi = combinePath(apiPrefixClient)('/match')

/** 对局详情结算行：按查看者掩码底牌与牌力（本人始终可见自己的底牌；弃牌/独赢无摊牌规则见调用处） */
function settleRecordVisibleFields<
  H,
  C extends string | null,
  S extends number
>(args: {
  isSelf: boolean
  isFold: boolean
  hideHoleCardsFromViewer: boolean
  handPokes: H
  rankCategory: C
  rankStrength: S
}): { handPokes: H | []; rankCategory: C | null; rankStrength: S | 0 } {
  const {
    isSelf,
    isFold,
    hideHoleCardsFromViewer,
    handPokes,
    rankCategory,
    rankStrength
  } = args
  const showHoleCards = isSelf || !hideHoleCardsFromViewer
  const showRankInfo = !isFold && (isSelf || !hideHoleCardsFromViewer)
  return {
    handPokes: showHoleCards ? handPokes : [],
    rankCategory: showRankInfo ? rankCategory : null,
    rankStrength: showRankInfo ? rankStrength : 0
  }
}

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
            room: true,
            _count: {
              select: { domainEvents: true }
            }
          }
        },
        id: true,
        handPokes: true,
        wager: true,
        isAllIn: true,
        isFold: true,
        rankCategory: true,
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

  const listForResponse = records.map(({ match, ...restRecord }) => {
    const {
      id: matchId,
      room: { code: roomCode, initialChips },
      _count,
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
      replaySupported: _count.domainEvents > 0,
      startedAt: startedAt ? dayjs(startedAt).format(timeFormat) : null,
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
    response.error(ctx, HTTP_STATUS.BAD_REQUEST, '参数异常：需要 matchId')
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
              pokerBackgroundKey: true,
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
              pokerBackgroundKey: true,
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
    response.error(ctx, HTTP_STATUS.NOT_FOUND, '对局不存在')
    return
  }

  const participated = await playerMatchRecord.findUnique({
    where: {
      matchId_userId: { matchId, userId }
    }
  })
  if (!participated) {
    response.error(ctx, HTTP_STATUS.FORBIDDEN, '无权查看该对局')
    return
  }

  const {
    room: { code: roomCode, id: roomId, initialChips },
    endedAt,
    records,
    startedAt,
    playerMatchRecords,
    ...restMatchInfo
  } = matchInfo

  const totalPlayers = playerMatchRecords.length
  const foldedCount = playerMatchRecords.filter((p) => p.isFold).length
  /** 仅一人未弃牌收池，无摊牌；赢家底牌对其他人不可见 */
  const isNoShowdownSingleWinner =
    totalPlayers >= 1 && foldedCount === totalPlayers - 1
  const viewerId = userId

  const wagerDesc = (
    a: { wager: number | null },
    b: { wager: number | null }
  ) => (Number(b.wager) || 0) - (Number(a.wager) || 0)

  // 玩家结算记录：未弃牌在前（先比 rankStrength，再比 wager）；弃牌在后（按 wager）
  const settleRecords = [...playerMatchRecords]
    .sort((a, b) => {
      if (a.isFold !== b.isFold) return a.isFold ? 1 : -1
      if (!a.isFold && !b.isFold) {
        if (a.rankStrength !== b.rankStrength) {
          return b.rankStrength - a.rankStrength
        }
        return wagerDesc(a, b)
      }
      return wagerDesc(a, b)
    })
    .map(
      ({
        handPokes,
        isFold,
        user: { id: recordUserId, ...user },
        rankCategory,
        rankStrength,
        ...rest
      }) => {
        const isSelf = recordUserId === viewerId
        /** 非本人：弃牌者始终不可见；一人独赢无摊牌时其余所有人底牌均不可见（含赢家） */
        const hideHoleCardsFromViewer =
          !isSelf && (isFold || isNoShowdownSingleWinner)

        const {
          handPokes: outHandPokes,
          rankCategory: outRankCategory,
          rankStrength: outRankStrength
        } = settleRecordVisibleFields({
          isSelf,
          isFold,
          hideHoleCardsFromViewer,
          handPokes,
          rankCategory,
          rankStrength
        })

        return {
          ...user,
          ...rest,
          userId: recordUserId,
          isFold,
          handPokes: outHandPokes,
          rankCategory: outRankCategory,
          rankStrength: outRankStrength
        }
      }
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
    startedAt: startedAt ? dayjs(startedAt).format(timeFormat) : null,
    endedAt: endedAt ? dayjs(endedAt).format(timeFormat) : null,
    settleRecords,
    actionRecords
  })
})

/**
 * 回放磁带（参与者可见）：返回按 DB 追加顺序的领域事件磁带。
 * 仅保留本人私牌，其他玩家 `HoleCardsDealt` 会脱敏为空数组；
 * 同时返回按 viewer 掩码后的终局 `settleList`（排序与线上 game-end 一致）。
 * `meta.replaySupported`：本局是否在 `MatchDomainEvent` 有落盘；无磁带时 `tape` 为空且不会查库加载磁带。
 */
router.post(matchApi('/replayTape'), async (ctx) => {
  const userId = ctx.state.user!.id
  const { matchId }: { matchId?: number } = ctx.request.body ?? {}
  if (!matchId) {
    response.error(ctx, HTTP_STATUS.BAD_REQUEST, '参数异常：需要 matchId')
    return
  }

  const [matchInfo, domainEventCount] = await Promise.all([
    match.findUnique({
      where: { id: matchId, endedAt: { not: null } },
      include: {
        room: true,
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
        }
      }
    }),
    matchDomainEvent.count({ where: { matchId } })
  ])
  const replaySupported = domainEventCount > 0
  if (!matchInfo) {
    response.error(ctx, HTTP_STATUS.NOT_FOUND, '对局不存在')
    return
  }

  const participated = matchInfo.playerMatchRecords.some(
    (record) => record.userId === userId
  )
  if (!participated) {
    response.error(ctx, HTTP_STATUS.FORBIDDEN, '无权查看该对局')
    return
  }
  if (!replaySupported) {
    response.error(ctx, HTTP_STATUS.CONFLICT, '该对局暂无可回放磁带')
    return
  }

  const [replay, replayComposite] = await Promise.all([
    loadMatchReplayTapeForViewer(matchId, userId),
    loadMatchCompositeReadModelFromDbTape(matchId)
  ])
  const isNoShowdownSingleWinner =
    replayComposite.compositeReadModel.lastHandEnded?.showHandPokes === false
  const unfoldedOnSetCount = matchInfo.playerMatchRecords.filter(
    (record) => !record.isFold
  ).length
  const settleList = [...matchInfo.playerMatchRecords]
    .sort((a, b) => {
      if (a.isFold !== b.isFold) return a.isFold ? 1 : -1
      if (!a.isFold && !b.isFold) {
        if (a.rankStrength !== b.rankStrength) {
          return b.rankStrength - a.rankStrength
        }
        return (Number(b.wager) || 0) - (Number(a.wager) || 0)
      }
      return (Number(b.wager) || 0) - (Number(a.wager) || 0)
    })
    .map((record) => {
      const isSelf = record.userId === userId
      const hideHoleCardsFromViewer =
        !isSelf && (record.isFold || isNoShowdownSingleWinner)
      const visible = settleRecordVisibleFields({
        isSelf,
        isFold: record.isFold,
        hideHoleCardsFromViewer,
        handPokes: record.handPokes,
        rankCategory: record.rankCategory,
        rankStrength: record.rankStrength
      })
      return {
        userId: record.userId,
        balance: Number(record.balanceAfterHand ?? 0),
        wager: record.wager,
        isAllIn: record.isAllIn,
        isFold: record.isFold,
        canVoluntaryShowHand: record.isFold || unfoldedOnSetCount === 1,
        handPokes: visible.handPokes,
        rankCategory: visible.rankCategory,
        rankStrength: visible.rankStrength
      }
    })

  response.success(ctx, {
    meta: {
      matchId: matchInfo.id,
      /** 本局是否在 `MatchDomainEvent` 落过领域事件磁带；历史对局可能为 false，仅可展示结算等、无 tape 回放 */
      replaySupported,
      roomId: matchInfo.roomId,
      roomCode: matchInfo.room.code,
      initialChips: matchInfo.room.initialChips,
      lowestBetAmount: matchInfo.room.lowestBetAmount,
      thinkingTime: matchInfo.room.thinkingTime,
      selfUserId: userId,
      startedAt: matchInfo.startedAt
        ? dayjs(matchInfo.startedAt).format(timeFormat)
        : null,
      endedAt: matchInfo.endedAt
        ? dayjs(matchInfo.endedAt).format(timeFormat)
        : null,
      members: matchInfo.playerMatchRecords.map((record) => ({
        userId: record.userId,
        name: record.user.name,
        avatarUrl: record.user.avatarUrl,
        balanceAtHandStart: record.balanceAtHandStart,
        avatarKey: record.user.avatarKey,
        pokerBackgroundKey: record.user.pokerBackgroundKey
        // balanceAfterHand: record.balanceAfterHand
      }))
    },
    tape: replay.tape,
    tapeIssues: replay.tapeIssues,
    settleList
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
    response.error(ctx, HTTP_STATUS.CONFLICT, '当前不在对局房间中')
    return
  }

  const texas = gameRuntimeRegistry.getTexas(String(roomId))
  if (!texas) {
    response.error(ctx, HTTP_STATUS.NOT_FOUND, '对局不存在')
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
  const activeUserId = activePlayer?.getUserInfo().id
  const scheduled = getScheduledPlayerTurnDeadline(String(roomId))
  const serverNow = Date.now()
  const turnAligns =
    activeUserId != null &&
    scheduled != null &&
    scheduled.userId === activeUserId &&
    texas.controller.currentHandId === scheduled.handId

  const activePlayerInfo = {
    userInfo: activePlayer?.getUserInfo(),
    /** 与 WS `player-action-required` 一致：剩余时间用 `deadlineAt - 本地 now`，可结合 `serverNow` 估时钟偏差 */
    deadlineAt: turnAligns ? scheduled.deadlineAt : null,
    serverNow: turnAligns ? serverNow : undefined
  }

  response.success(ctx, {
    matchId: currentMatchId,
    roomId: Number(roomId),
    status: texas.controller.status,
    stage: texas.controller.stage,
    pool: texas.pool.totalAmount,
    commonPokes: texas.dealer.getPokes().commonPokes,
    activePlayerInfo,
    playersOnSeat,
    playersOnWatch
  })
})
