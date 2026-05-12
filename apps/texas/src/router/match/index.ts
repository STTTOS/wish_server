import type { WithPaginationReq } from '../interface'
import type { RoomTableType } from '../../constants/game'

import dayjs from 'dayjs'
import { Prisma } from '@prisma/texas-client'

import './web'
import './handPokeAuditWeb'
import router from '../instance'
import combinePath from '../../utils/combinePath'
import { ROOM_TABLE_TYPES } from '../../constants/game'
import { HTTP_STATUS } from '../../constants/httpStatus'
import response, { withList } from '../../utils/response'
import { timeFormat, apiPrefixClient } from '../../config'
import {
  user,
  match,
  userRoomStat,
  userSettings,
  matchDomainEvent,
  playerMatchRecord
} from '../../models'
import {
  loadMatchReplayTapeForViewer,
  loadMatchCompositeReadModelFromDbTape
} from '../game/services/matchReplayReadModel'
import {
  settleRecordVisibleFields,
  sortSettleRecordsByOutcome,
  projectSettleRecordsForMatchDetail
} from './matchSettleVisibility'

const matchApi = combinePath(apiPrefixClient)('/match')

function parseTargetUserId(
  raw: unknown,
  fallbackUserId: number
): number | null {
  if (raw == null) return fallbackUserId
  const n = Number(raw)
  if (!Number.isInteger(n) || n <= 0) return null
  return n
}

async function canViewUserHistory(viewerUserId: number, targetUserId: number) {
  if (viewerUserId === targetUserId) return true
  const settings = await userSettings.findUnique({
    where: { userId: targetUserId },
    select: { showHistoryRecords: true }
  })
  return settings?.showHistoryRecords !== false
}

async function canViewUserOverview(viewerUserId: number, targetUserId: number) {
  if (viewerUserId === targetUserId) return true
  const settings = await userSettings.findUnique({
    where: { userId: targetUserId },
    select: { showRecordOverview: true }
  })
  return settings?.showRecordOverview !== false
}

async function ensureTargetUserExists(targetUserId: number): Promise<boolean> {
  const exists = await user.findUnique({
    where: { id: targetUserId },
    select: { id: true }
  })
  return exists != null
}

/**
 * 查询当前用户的对局记录（分页）
 */
router.post(matchApi('/list'), async (ctx) => {
  const viewerUserId = ctx.state.user!.id
  const {
    current = 1,
    pageSize = 10,
    roomId,
    type,
    userId
  }: WithPaginationReq & {
    roomId?: number
    type?: string
    userId?: number
  } = ctx.request.body ?? {}

  const targetUserId = parseTargetUserId(userId, viewerUserId)
  if (targetUserId == null) {
    response.error(ctx, HTTP_STATUS.BAD_REQUEST, 'userId 参数异常')
    return
  }
  if (!(await ensureTargetUserExists(targetUserId))) {
    response.error(ctx, HTTP_STATUS.NOT_FOUND, '用户不存在')
    return
  }
  if (!(await canViewUserHistory(viewerUserId, targetUserId))) {
    response.error(ctx, HTTP_STATUS.FORBIDDEN, '该玩家隐藏了历史战绩', {
      type: 'USER_HISTORY_PRIVATE'
    })
    return
  }

  const skip = (current - 1) * pageSize
  const take = pageSize

  if (
    type &&
    type !== 'all' &&
    !(ROOM_TABLE_TYPES as readonly string[]).includes(type)
  ) {
    response.error(ctx, HTTP_STATUS.BAD_REQUEST, 'type 参数异常')
    return
  }

  const tableTypeFilter: RoomTableType | null =
    type && type !== 'all' ? (type as RoomTableType) : null

  const matchWhere: Prisma.MatchWhereInput = {
    endedAt: { not: null },
    ...(roomId ? { roomId } : null),
    ...(tableTypeFilter
      ? { room: { is: { tableType: tableTypeFilter } } }
      : null)
  }
  const where: Prisma.PlayerMatchRecordWhereInput = {
    userId: targetUserId,
    match: matchWhere
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
      room: { activeCode, initialChips },
      _count,
      startedAt,
      endedAt,
      ...restMatch
    } = match
    return {
      ...restRecord,
      ...restMatch,
      matchId,
      roomCode: activeCode ?? '',
      initialChips,
      tableType: match.room.tableType,
      sevenTwoBonusEnabled: match.room.sevenTwoBonusEnabled,
      replaySupported: targetUserId === viewerUserId && _count.domainEvents > 0,
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
      roomCode: stat.room.activeCode ?? '',
      lowestBetAmount: stat.room.lowestBetAmount,
      thinkingTime: stat.room.thinkingTime,
      isPrivate: stat.room.isPrivate,
      tableType: stat.room.tableType,
      sevenTwoBonusEnabled: stat.room.sevenTwoBonusEnabled,
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
  const viewerUserId = ctx.state.user!.id
  const { userId }: { userId?: number } = ctx.request.body ?? {}
  const targetUserId = parseTargetUserId(userId, viewerUserId)
  if (targetUserId == null) {
    response.error(ctx, HTTP_STATUS.BAD_REQUEST, 'userId 参数异常')
    return
  }
  if (!(await ensureTargetUserExists(targetUserId))) {
    response.error(ctx, HTTP_STATUS.NOT_FOUND, '用户不存在')
    return
  }
  if (!(await canViewUserOverview(viewerUserId, targetUserId))) {
    response.error(ctx, HTTP_STATUS.FORBIDDEN, '该玩家隐藏了战绩总览', {
      type: 'USER_OVERVIEW_PRIVATE'
    })
    return
  }

  const records = await playerMatchRecord.findMany({
    where: { userId: targetUserId },
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
 * 查询对局详情（当前用户必须参与过该对局；**含进行中**，他人手牌与牌力见 {@link projectSettleRecordsForMatchDetail}）。
 */
router.post(matchApi('/detail'), async (ctx) => {
  const viewerUserId = ctx.state.user!.id
  const { matchId }: { matchId?: number } = ctx.request.body ?? {}

  if (!matchId) {
    response.error(ctx, HTTP_STATUS.BAD_REQUEST, '参数异常：需要 matchId')
    return
  }

  const matchInfo = await match.findUnique({
    where: { id: matchId },
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
              tableBackgroundKey: true,
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
          rankSignature: true,
          totalBetAmount: true,
          sevenTwoBonusPaid: true,
          sevenTwoBonusReceived: true
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
              tableBackgroundKey: true,
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

  const viewerParticipated = await playerMatchRecord.findUnique({
    where: {
      matchId_userId: { matchId, userId: viewerUserId }
    }
  })
  if (!viewerParticipated) {
    response.error(ctx, HTTP_STATUS.FORBIDDEN, '你未参与此对局,无法查看详情', {
      type: 'MATCH_NOT_PARTICIPATED'
    })
    return
  }

  const {
    room: { activeCode, id: roomId, initialChips },
    endedAt,
    records,
    startedAt,
    playerMatchRecords,
    ...restMatchInfo
  } = matchInfo

  const settleRecords = projectSettleRecordsForMatchDetail(playerMatchRecords, {
    viewerUserId,
    matchEnded: endedAt != null
  })

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
    roomCode: activeCode ?? '',
    initialChips,
    tableType: matchInfo.room.tableType,
    sevenTwoBonusEnabled: matchInfo.room.sevenTwoBonusEnabled,
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
                pokerBackgroundKey: true,
                tableBackgroundKey: true
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
  const settleList = sortSettleRecordsByOutcome(
    matchInfo.playerMatchRecords
  ).map((record) => {
    const isSelf = record.userId === userId
    const hideHoleCardsFromViewer =
      !isSelf && (record.isFold || isNoShowdownSingleWinner)
    const visible = settleRecordVisibleFields({
      isSelf,
      isFold: record.isFold,
      hideHoleCardsFromViewer,
      handPokes: record.handPokes,
      rankCategory: record.rankCategory,
      rankStrength: record.rankStrength,
      rankSignature: record.rankSignature
    })
    const balanceAfter = Number(record.balanceAfterHand ?? 0)
    return {
      userId: record.userId,
      name: record.user.name,
      avatarUrl: record.user.avatarUrl,
      avatarKey: record.user.avatarKey,
      pokerBackgroundKey: record.user.pokerBackgroundKey,
      balance: balanceAfter,
      wager: record.wager,
      sevenTwoBonusPaid: record.sevenTwoBonusPaid,
      sevenTwoBonusReceived: record.sevenTwoBonusReceived,
      isAllIn: record.isAllIn,
      isFold: record.isFold,
      canVoluntaryShowHand:
        (record.isFold || unfoldedOnSetCount === 1) &&
        Number(record.sevenTwoBonusReceived ?? 0) <= 0,
      handPokes: visible.handPokes,
      rankCategory: visible.rankCategory,
      rankStrength: visible.rankStrength,
      rankSignature: visible.rankSignature
    }
  })

  response.success(ctx, {
    meta: {
      matchId: matchInfo.id,
      /** 本局是否在 `MatchDomainEvent` 落过领域事件磁带；历史对局可能为 false，仅可展示结算等、无 tape 回放 */
      replaySupported,
      roomId: matchInfo.roomId,
      roomCode: matchInfo.room.activeCode ?? '',
      initialChips: matchInfo.room.initialChips,
      lowestBetAmount: matchInfo.room.lowestBetAmount,
      thinkingTime: matchInfo.room.thinkingTime,
      tableType: matchInfo.room.tableType,
      sevenTwoBonusEnabled: matchInfo.room.sevenTwoBonusEnabled,
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
        pokerBackgroundKey: record.user.pokerBackgroundKey,
        gameSeatStatus: 'on_set' as const
      }))
    },
    tape: replay.tape,
    tapeIssues: replay.tapeIssues,
    settleList
  })
})
