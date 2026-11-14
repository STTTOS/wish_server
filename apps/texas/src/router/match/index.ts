import type { WithPaginationReq } from '../interface'
import type { RoomTableType } from '../../constants/game'

import dayjs from 'dayjs'
import { Prisma } from '@prisma/texas-client'

import './web'
import './handPokeAuditWeb'
import router from '../instance'
import combinePath from '../../utils/combinePath'
import { fetchMatchRoomsList } from './matchRoomsList'
import { ROOM_TABLE_TYPES } from '../../constants/game'
import { HTTP_STATUS } from '../../constants/httpStatus'
import response, { withList } from '../../utils/response'
import { timeFormat, apiPrefixClient } from '../../config'
import { getPlayerHonors } from '../../styleStats/playerHonors'
import { fetchMatchOverviewForRoom } from '../game/services/matchOverviewAggregation'
import {
  user,
  match,
  userSettings,
  matchDomainEvent,
  playerMatchRecord
} from '../../models'
import {
  computeRunWagers,
  mapsFromStoredRunAwards
} from '../game/services/texasDomain/runoutSettleAwards'
import {
  loadMatchReplayTapeForViewer,
  loadMatchCompositeReadModelFromDbTape
} from '../game/services/matchReplayReadModel'
import {
  settleRecordVisibleFields,
  sortSettleRecordsByOutcome,
  projectSettleRecordsForMatchDetail,
  projectTargetUserHistoryListFields,
  isNoShowdownSingleWinnerFromParticipants
} from './matchSettleVisibility'
import {
  parseMatchListSort,
  resolveStartedAtFilter,
  resolveBoardStageFilter,
  resolveMatchListOrderBy,
  parseMatchListRankFilter,
  parseMatchListTimePreset,
  parseMatchListMemberCount,
  parseMatchListStageFilter,
  parseMatchListResultFilter,
  loadMatchIdsWithExactPlayerCount
} from './matchListClientFilters'

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

async function loadNoShowdownSingleWinnerByMatchId(
  matchIds: number[]
): Promise<Map<number, boolean>> {
  const result = new Map<number, boolean>()
  if (matchIds.length === 0) return result

  const rows = await playerMatchRecord.findMany({
    where: { matchId: { in: matchIds } },
    select: { matchId: true, isFold: true }
  })
  const byMatchId = new Map<number, { isFold: boolean }[]>()
  for (const row of rows) {
    const list = byMatchId.get(row.matchId) ?? []
    list.push({ isFold: row.isFold })
    byMatchId.set(row.matchId, list)
  }
  for (const [matchId, participants] of byMatchId) {
    result.set(matchId, isNoShowdownSingleWinnerFromParticipants(participants))
  }
  return result
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
    userId,
    rankFilter,
    timePreset,
    resultFilter,
    endStage,
    memberCount,
    sort
  }: WithPaginationReq & {
    roomId?: number
    type?: string
    userId?: number
    /** 全部牌型 | 未成牌(翻前结束) | 具体牌型字母 */
    rankFilter?: string
    /** 所有时间 | 近3天 | 近一周 | 近一月 */
    timePreset?: string
    /** 全部 | 赢 | 输 */
    resultFilter?: string
    /** 全部 | 结束轮次 Stage */
    endStage?: string
    /** 全部 | 2–10 人桌 */
    memberCount?: number | string
    /** 时间倒序 | 输赢降序 | 输赢升序 */
    sort?: string
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

  const resolvedRankFilter = parseMatchListRankFilter(rankFilter)
  if (resolvedRankFilter == null) {
    response.error(ctx, HTTP_STATUS.BAD_REQUEST, 'rankFilter 参数异常')
    return
  }

  const resolvedTimePreset = parseMatchListTimePreset(timePreset)
  if (resolvedTimePreset == null) {
    response.error(ctx, HTTP_STATUS.BAD_REQUEST, 'timePreset 参数异常')
    return
  }

  const resolvedResultFilter = parseMatchListResultFilter(resultFilter)
  if (resolvedResultFilter == null) {
    response.error(ctx, HTTP_STATUS.BAD_REQUEST, 'resultFilter 参数异常')
    return
  }

  const resolvedEndStage = parseMatchListStageFilter(endStage)
  if (resolvedEndStage == null) {
    response.error(ctx, HTTP_STATUS.BAD_REQUEST, 'endStage 参数异常')
    return
  }

  const resolvedMemberCount = parseMatchListMemberCount(memberCount)
  if (resolvedMemberCount == null) {
    response.error(ctx, HTTP_STATUS.BAD_REQUEST, 'memberCount 参数异常')
    return
  }

  const resolvedSort = parseMatchListSort(sort)
  if (resolvedSort == null) {
    response.error(ctx, HTTP_STATUS.BAD_REQUEST, 'sort 参数异常')
    return
  }

  const startedAtResolved = resolveStartedAtFilter(resolvedTimePreset)
  if (!startedAtResolved.ok) {
    response.error(ctx, HTTP_STATUS.BAD_REQUEST, startedAtResolved.message)
    return
  }

  const tableTypeFilter: RoomTableType | null =
    type && type !== 'all' ? (type as RoomTableType) : null

  const boardStageResolved = resolveBoardStageFilter(
    resolvedRankFilter,
    resolvedEndStage
  )
  if (boardStageResolved == null) {
    response.success(ctx, withList([], 0))
    return
  }

  const matchWhere: Prisma.MatchWhereInput = {
    endedAt: { not: null },
    ...(roomId ? { roomId } : null),
    ...(tableTypeFilter
      ? { room: { is: { tableType: tableTypeFilter } } }
      : null),
    ...(boardStageResolved !== 'all'
      ? { boardThroughStage: boardStageResolved }
      : null),
    ...(startedAtResolved.filter
      ? { startedAt: startedAtResolved.filter }
      : null)
  }

  if (resolvedMemberCount !== 'all') {
    const matchIds = await loadMatchIdsWithExactPlayerCount({
      targetUserId,
      memberCount: resolvedMemberCount,
      matchWhere
    })
    if (matchIds.length === 0) {
      response.success(ctx, withList([], 0))
      return
    }
    matchWhere.id = { in: matchIds }
  }

  let wagerWhere: Prisma.FloatFilter | undefined
  if (resolvedResultFilter === 'win') wagerWhere = { gt: 0 }
  else if (resolvedResultFilter === 'lose') wagerWhere = { lt: 0 }

  const where: Prisma.PlayerMatchRecordWhereInput = {
    userId: targetUserId,
    match: matchWhere,
    ...(resolvedRankFilter !== 'all' && resolvedRankFilter !== 'unmade'
      ? { rankCategory: resolvedRankFilter }
      : null),
    ...(wagerWhere ? { wager: wagerWhere } : null)
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
              select: { domainEvents: true, playerMatchRecords: true }
            }
          }
        },
        id: true,
        handPokes: true,
        wager: true,
        isAllIn: true,
        isFold: true,
        rankCategory: true,
        totalBetAmount: true,
        voluntaryShowHandAt: true
      },
      orderBy: resolveMatchListOrderBy(resolvedSort),
      skip,
      take
    })
  ])

  const viewingSelf = targetUserId === viewerUserId
  const matchIds = [...new Set(records.map((r) => r.match.id))]
  const noShowdownSingleWinnerByMatchId = viewingSelf
    ? new Map<number, boolean>()
    : await loadNoShowdownSingleWinnerByMatchId(matchIds)

  const listForResponse = records.map(
    ({ match, voluntaryShowHandAt, ...restRecord }) => {
      const {
        id: matchId,
        room: { activeCode, initialChips },
        _count,
        startedAt,
        endedAt,
        ...restMatch
      } = match

      const visibleFields = projectTargetUserHistoryListFields({
        viewingSelf,
        isFold: restRecord.isFold,
        isNoShowdownSingleWinner:
          noShowdownSingleWinnerByMatchId.get(matchId) ?? false,
        voluntarilyShownHand: voluntaryShowHandAt != null,
        handPokes: restRecord.handPokes,
        rankCategory: restRecord.rankCategory
      })

      return {
        ...restRecord,
        handPokes: visibleFields.handPokes,
        rankCategory: visibleFields.rankCategory,
        voluntarilyShownHand: visibleFields.voluntarilyShownHand,
        ...restMatch,
        matchId,
        roomCode: activeCode ?? '',
        initialChips,
        tableType: match.room.tableType,
        sevenTwoBonusEnabled: match.room.sevenTwoBonusEnabled,
        memberCount: _count.playerMatchRecords,
        replaySupported: viewingSelf && _count.domainEvents > 0,
        startedAt: startedAt ? dayjs(startedAt).format(timeFormat) : null,
        endedAt: endedAt ? dayjs(endedAt).format(timeFormat) : null
      }
    }
  )

  response.success(ctx, withList(listForResponse, total))
})
/**
 * 参与过的房间列表（至少一手，分页：与 `/match/list` 同形 `{ total, list }`）。
 * 以 `PlayerMatchRecord` 聚合为准（`UserRoomStat` 当前无写入路径，不可作权威源）。
 * Body：`current`/`pageSize`、可选 `userId`（他人视角）、`type`（桌型，同 list）。
 */
router.post(matchApi('/rooms'), async (ctx) => {
  const viewerUserId = ctx.state.user!.id
  const {
    current = 1,
    pageSize = 10,
    userId,
    type
  }: WithPaginationReq & {
    userId?: number
    type?: string
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

  if (
    type &&
    type !== 'all' &&
    !(ROOM_TABLE_TYPES as readonly string[]).includes(type)
  ) {
    response.error(ctx, HTTP_STATUS.BAD_REQUEST, 'type 参数异常')
    return
  }

  const tableType =
    type && type !== 'all' && ROOM_TABLE_TYPES.includes(type as RoomTableType)
      ? (type as RoomTableType)
      : undefined

  const { total, list } = await fetchMatchRoomsList({
    targetUserId,
    current,
    pageSize,
    tableType
  })
  response.success(ctx, withList(list, total))
})

/**
 * 战绩总览：当前用户总对局数、allIn 次数、弃牌次数；
 * 牌型成就（皇家同花顺 / 同花顺 / 四条）读荣誉物化表（双跑两跑分别计入，与成就奖励一致）。
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

  const [records, honors] = await Promise.all([
    playerMatchRecord.findMany({
      where: { userId: targetUserId },
      select: {
        isAllIn: true,
        isFold: true,
        wager: true,
        totalBetAmount: true
      }
    }),
    getPlayerHonors(targetUserId)
  ])

  const totalMatches = records.length

  let allInCount = 0
  /** All-In 局中 wager>0 的局数；胜率 = allInWinCount / allInCount */
  let allInWinCount = 0
  let foldCount = 0
  let winMatchCount = 0
  let loseMatchCount = 0
  let tieMatchCount = 0
  let totalBetAmount = 0
  let totalWager = 0
  /** 单局最大赢分（wager 最大正值；无盈利局为 0） */
  let maxWinWager = 0
  /** 单局最大输分（wager 最小负值的绝对值语义：存负数；无亏损局为 0） */
  let maxLoseWager = 0

  records.forEach((r) => {
    if (r.isFold) foldCount += 1

    const wager = r.wager ?? 0
    if (r.isAllIn) {
      allInCount += 1
      if (wager > 0) allInWinCount += 1
    }
    if (wager > 0) winMatchCount += 1
    else if (wager < 0) loseMatchCount += 1
    else tieMatchCount += 1

    if (wager > maxWinWager) maxWinWager = wager
    if (wager < maxLoseWager) maxLoseWager = wager

    totalBetAmount += r.totalBetAmount ?? 0
    totalWager += wager
  })

  response.success(ctx, {
    totalMatches,
    allInCount,
    allInWinCount,
    foldCount,
    royalFlushCount: honors.royalFlushCount,
    straightFlushCount: honors.straightFlushCount,
    fourOfKindCount: honors.fourOfKindCount,
    winMatchCount,
    loseMatchCount,
    tieMatchCount,
    totalBetAmount,
    totalWager,
    maxWinWager,
    maxLoseWager
  })
})

/**
 * 房间输赢总览（与对局中 `matchOverview` 同源）：须曾参与该房至少一手。
 * Body: `{ roomId }`
 */
router.post(matchApi('/room-overview'), async (ctx) => {
  const viewerUserId = ctx.state.user!.id
  const roomId = Number((ctx.request.body as { roomId?: number })?.roomId)
  if (!Number.isInteger(roomId) || roomId <= 0) {
    response.error(ctx, HTTP_STATUS.BAD_REQUEST, '参数异常：需要 roomId')
    return
  }

  const participated = await playerMatchRecord.findFirst({
    where: { userId: viewerUserId, match: { roomId } },
    select: { id: true }
  })
  if (!participated) {
    response.error(
      ctx,
      HTTP_STATUS.FORBIDDEN,
      '你未参与该房间对局,无法查看总览',
      {
        type: 'ROOM_OVERVIEW_FORBIDDEN'
      }
    )
    return
  }

  const overview = await fetchMatchOverviewForRoom(roomId)
  response.success(ctx, overview)
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
          userId: true,
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
          sevenTwoBonusReceived: true,
          voluntaryShowHandAt: true
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

  const settleRecordsBase = projectSettleRecordsForMatchDetail(
    playerMatchRecords,
    {
      viewerUserId,
      matchEnded: endedAt != null
    }
  )

  const potTotal = Number(restMatchInfo.totalBetAmount ?? 0)
  const settlementRuns = Array.isArray(restMatchInfo.settlementRuns)
    ? (restMatchInfo.settlementRuns as Array<{
        awards?: unknown
        winnerUserIds?: number[]
      }>)
    : null
  // 仅信任落库 awards；勿用 winnerUserIds 均分半池（边池会算错钱）
  const runAwardMaps =
    restMatchInfo.runCount === 2
      ? mapsFromStoredRunAwards(settlementRuns?.map((r) => r?.awards) ?? null)
      : null
  const settleRecords =
    runAwardMaps == null
      ? settleRecordsBase
      : settleRecordsBase.map((row) => {
          const totalBet = Number(
            playerMatchRecords.find((r) => r.userId === row.userId)
              ?.totalBetAmount ?? 0
          )
          return {
            ...row,
            runWagers: computeRunWagers({
              userId: row.userId,
              totalBetAmount: totalBet,
              potTotal,
              runAwards: runAwardMaps
            })
          }
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
    const voluntarilyShownHand = record.voluntaryShowHandAt != null
    const hideHoleCardsFromViewer =
      !isSelf &&
      !voluntarilyShownHand &&
      (record.isFold || isNoShowdownSingleWinner)
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
      voluntarilyShownHand,
      canVoluntaryShowHand:
        (record.isFold || unfoldedOnSetCount === 1) &&
        !voluntarilyShownHand &&
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
    settleList,
    /** 双跑落库快照（含 `seats`）；回放合成 runout 席位标签优先于此 */
    settlementRuns:
      matchInfo.runCount === 2 && matchInfo.settlementRuns != null
        ? matchInfo.settlementRuns
        : null
  })
})
