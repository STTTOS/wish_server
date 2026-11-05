import dayjs from 'dayjs'

import router from './instance'
import { apiPrefixWeb } from '../config'
import response from '../utils/response'
import { assertWebUser } from './webAuth'
import formatTime from '../utils/formatTime'
import combinePath from '../utils/combinePath'
import { HTTP_STATUS } from '../constants/httpStatus'
import { room, match, playerMatchRecord } from '../models'
import { fetchMatchOverviewForRoom } from './game/services/matchOverviewAggregation'

const minScorePathWebApi = combinePath(apiPrefixWeb)('/min-score-path')

/** 列表只查近 N 天内有对局的房间 */
const ROOM_LIST_LOOKBACK_DAYS = 15

type RoomListItem = {
  roomId: number
  activeCode: string | null
  matchCount: number
  lastMatchAt: string | null
  tableType: string
  lowestBetAmount: number
  initialChips: number
}

/**
 * C 端：仅当前登录用户参与过的房间（非全站房间）。
 * 条件：该用户在近 15 天内至少有一手 `PlayerMatchRecord`；按最近对局时间倒序。
 */
router.post(minScorePathWebApi('/rooms'), async (ctx) => {
  const userId = await assertWebUser(ctx)
  if (userId == null) return

  const since = dayjs().subtract(ROOM_LIST_LOOKBACK_DAYS, 'day').toDate()

  const grouped = await match.groupBy({
    by: ['roomId'],
    where: {
      // 硬约束：只聚合「本人参与过」的对局所属房间
      playerMatchRecords: { some: { userId } },
      OR: [
        { endedAt: { gte: since } },
        { startedAt: { gte: since } },
        { createdAt: { gte: since } }
      ]
    },
    _count: { _all: true },
    _max: { endedAt: true, startedAt: true, createdAt: true }
  })

  const withMatches = grouped.filter((g) => g._count._all > 0)
  if (withMatches.length === 0) {
    response.success(ctx, { list: [] as RoomListItem[] })
    return
  }

  const roomIds = withMatches.map((g) => g.roomId)
  const rooms = await room.findMany({
    where: { id: { in: roomIds } },
    select: {
      id: true,
      activeCode: true,
      tableType: true,
      lowestBetAmount: true,
      initialChips: true
    }
  })
  const roomById = new Map(rooms.map((r) => [r.id, r]))

  const list: RoomListItem[] = withMatches
    .map((g) => {
      const lastAt = g._max.endedAt ?? g._max.startedAt ?? g._max.createdAt
      const r = roomById.get(g.roomId)
      return {
        roomId: g.roomId,
        activeCode: r?.activeCode ?? null,
        matchCount: g._count._all,
        lastMatchAt: lastAt ? formatTime(lastAt) : null,
        tableType: r?.tableType ?? 'standard',
        lowestBetAmount: r?.lowestBetAmount ?? 0,
        initialChips: r?.initialChips ?? 0,
        _sort: lastAt?.getTime() ?? 0
      }
    })
    .sort((a, b) => b._sort - a._sort)
    .map(
      ({
        roomId,
        activeCode,
        matchCount,
        lastMatchAt,
        tableType,
        lowestBetAmount,
        initialChips
      }) => ({
        roomId,
        activeCode,
        matchCount,
        lastMatchAt,
        tableType,
        lowestBetAmount,
        initialChips
      })
    )

  response.success(ctx, { list })
})

/**
 * C 端：某房间最小积分路径（原 billList）+ 输赢汇总。
 * 仅本房参与过至少一手的用户可查。
 */
router.post(minScorePathWebApi('/detail'), async (ctx) => {
  const userId = await assertWebUser(ctx)
  if (userId == null) return

  const roomId = Number((ctx.request.body as { roomId?: number })?.roomId)
  if (!Number.isInteger(roomId) || roomId <= 0) {
    response.error(ctx, HTTP_STATUS.BAD_REQUEST, '参数异常：需要 roomId')
    return
  }

  const participated = await playerMatchRecord.findFirst({
    where: { userId, match: { roomId } },
    select: { id: true }
  })
  if (!participated) {
    response.error(ctx, HTTP_STATUS.FORBIDDEN, '无权查看该房间')
    return
  }

  const roomRow = await room.findUnique({
    where: { id: roomId },
    select: {
      id: true,
      activeCode: true,
      tableType: true,
      lowestBetAmount: true,
      initialChips: true
    }
  })
  if (!roomRow) {
    response.error(ctx, HTTP_STATUS.NOT_FOUND, '房间不存在')
    return
  }

  const matchCount = await match.count({
    where: {
      roomId,
      playerMatchRecords: { some: { userId } }
    }
  })
  if (matchCount <= 0) {
    response.error(ctx, HTTP_STATUS.BAD_REQUEST, '该房间尚无对局记录')
    return
  }

  const overview = await fetchMatchOverviewForRoom(roomId)
  const profileById = new Map(overview.playerProfiles.map((p) => [p.userId, p]))

  const minScorePath = overview.billList.map((b) => {
    const from = profileById.get(b.fromUserId)
    const to = profileById.get(b.toUserId)
    return {
      fromUserId: b.fromUserId,
      toUserId: b.toUserId,
      amount: b.amount,
      fromName: from?.name ?? `玩家${b.fromUserId}`,
      toName: to?.name ?? `玩家${b.toUserId}`,
      fromAvatarUrl: from?.avatarUrl ?? null,
      fromAvatarKey: from?.avatarKey ?? 'cartoon/default',
      toAvatarUrl: to?.avatarUrl ?? null,
      toAvatarKey: to?.avatarKey ?? 'cartoon/default'
    }
  })

  response.success(ctx, {
    room: {
      roomId: roomRow.id,
      activeCode: roomRow.activeCode,
      tableType: roomRow.tableType,
      lowestBetAmount: roomRow.lowestBetAmount,
      initialChips: roomRow.initialChips,
      matchCount
    },
    minScorePath,
    wagerList: overview.wagerList,
    playerProfiles: overview.playerProfiles
  })
})
