import type { Stage } from '@prisma/texas-client'

import router from '../instance'
import { logger } from '../../logger'
import { apiPrefixWeb } from '../../config'
import formatTime from '../../utils/formatTime'
import combinePath from '../../utils/combinePath'
import { HTTP_STATUS } from '../../constants/httpStatus'
import response, { withList } from '../../utils/response'
import { buildMatchListWhere } from './buildMatchListWhere'
import { assertWebUser, assertMatchSensitiveAccess } from '../webAuth'
import { ROOM_TABLE_TYPES, type RoomTableType } from '../../constants/game'
import { projectSettleRecordsForMatchDetail } from './matchSettleVisibility'
import { loadMatchCompositeReadModelFromDbTape } from '../game/services/matchReplayReadModel'
import {
  user,
  match,
  betRecord,
  playerMatchRecord,
  engineFatalIncident
} from '../../models'

/** 与 Prisma `Stage` / `Match.boardThroughStage` 一致 */
const BOARD_THROUGH_STAGES = new Set(['pre_flop', 'flop', 'turn', 'river'])

const matchWebApi = combinePath(apiPrefixWeb)('/match')

router.post(matchWebApi('/list'), async (ctx) => {
  const userId = await assertWebUser(ctx)
  if (userId == null) return

  const {
    current: skip,
    pageSize: take,
    time,
    type,
    playerName,
    matchStatus,
    boardThroughStage: boardThroughStageRaw
  } = ctx.request.body as {
    current?: number
    pageSize?: number
    time?: [string, string]
    type?: string
    /** 管理员：参与用户昵称（`User.name`）模糊查询 */
    playerName?: string
    /** `all` | `in_progress` | `ended` */
    matchStatus?: string
    /** `all` 或 `pre_flop` | `flop` | `turn` | `river` */
    boardThroughStage?: string
  }
  if (!skip || !take) {
    response.error(ctx, HTTP_STATUS.BAD_REQUEST, '分页参数错误')
    return
  }

  const loginUser = await user.findUnique({
    where: { id: userId },
    select: { isAdmin: true }
  })
  if (!loginUser) {
    response.error(ctx, HTTP_STATUS.NOT_FOUND, '用户不存在')
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

  const tableType: RoomTableType | undefined =
    type && type !== 'all' ? (type as RoomTableType) : undefined

  const timeRange =
    time?.length === 2
      ? { start: new Date(time[0]), end: new Date(time[1]) }
      : undefined

  const participantNameTrimmed =
    typeof playerName === 'string' ? playerName.trim() : ''
  if (!loginUser.isAdmin && participantNameTrimmed) {
    response.error(ctx, HTTP_STATUS.FORBIDDEN, '仅管理员可按参与用户昵称筛选')
    return
  }

  const progress =
    matchStatus === 'in_progress' || matchStatus === 'ended'
      ? matchStatus
      : 'all'
  if (matchStatus && matchStatus !== 'all' && progress === 'all') {
    response.error(ctx, HTTP_STATUS.BAD_REQUEST, 'matchStatus 参数异常')
    return
  }

  const bts =
    typeof boardThroughStageRaw === 'string' ? boardThroughStageRaw.trim() : ''
  if (bts && bts !== 'all' && !BOARD_THROUGH_STAGES.has(bts)) {
    response.error(ctx, HTTP_STATUS.BAD_REQUEST, 'boardThroughStage 参数异常')
    return
  }

  const where = buildMatchListWhere({
    viewerUserId: userId,
    isAdmin: loginUser.isAdmin,
    tableType,
    timeRange,
    matchProgress: progress,
    boardThroughStage: bts && bts !== 'all' ? (bts as Stage) : undefined,
    participantNameContains: participantNameTrimmed || undefined
  })

  const total = await match.count({ where })
  const list = await match.findMany({
    take,
    skip: (skip - 1) * take,
    where,
    select: {
      id: true,
      startedAt: true,
      bestRankCategory: true,
      bestRankSignature: true,
      commonPokes: true,
      lowestBetAmount: true,
      endedAt: true,
      boardThroughStage: true,
      totalBetAmount: true,
      playerMatchRecords: {
        select: {
          id: true
        }
      },
      room: {
        select: {
          id: true,
          activeCode: true,
          initialChips: true,
          tableType: true,
          sevenTwoBonusEnabled: true
        }
      }
    },
    orderBy: {
      startedAt: 'desc'
    }
  })
  const matchIds = list.map((m) => m.id)
  const fatalByMatchId =
    matchIds.length === 0
      ? new Map<number, number>()
      : new Map(
          (
            await engineFatalIncident.groupBy({
              by: ['matchId'],
              where: { matchId: { in: matchIds } },
              _count: { _all: true }
            })
          ).map((r) => [r.matchId, r._count._all])
        )
  response.success(
    ctx,
    withList(
      list.map(({ playerMatchRecords, room, ...rest }) => {
        const {
          activeCode,
          id,
          initialChips,
          tableType,
          sevenTwoBonusEnabled
        } = room

        return {
          ...rest,
          roomId: id,
          initialChips,
          tableType,
          sevenTwoBonusEnabled,
          roomCode: activeCode ?? '',
          memberCount: playerMatchRecords.length,
          startedAt: formatTime(rest.startedAt),
          endedAt: formatTime(rest.endedAt),
          errorCount: fatalByMatchId.get(rest.id) ?? 0
        }
      }),
      total
    )
  )
})

router.post(matchWebApi('/detail/:id'), async (ctx) => {
  const userId = await assertWebUser(ctx)
  if (userId == null) return

  const id = Number(ctx.params.id)
  if (isNaN(id)) {
    response.error(ctx, HTTP_STATUS.BAD_REQUEST, '参数错误')
    return
  }
  const loginUser = await user.findUnique({
    where: { id: userId },
    select: { isAdmin: true }
  })
  if (!loginUser) {
    response.error(ctx, HTTP_STATUS.NOT_FOUND, '用户不存在')
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
              avatarKey: true,
              pokerBackgroundKey: true,
              tableBackgroundKey: true
            }
          }
        },
        orderBy: {
          createdAt: 'asc'
        }
      },
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
      },
      matchStageTimeRecord: {
        select: {
          endAt: true,
          startAt: true,
          stage: true
        }
      },
      room: {
        select: {
          tableType: true,
          initialChips: true,
          sevenTwoBonusEnabled: true
        }
      }
    }
  })
  if (!detail) {
    response.error(ctx, HTTP_STATUS.NOT_FOUND, '对局不存在')
    return
  }
  if (!loginUser.isAdmin) {
    const participated = detail.playerMatchRecords.some(
      (record) => record.userId === userId
    )
    if (!participated) {
      response.error(ctx, HTTP_STATUS.FORBIDDEN, '无权限查看该对局')
      return
    }
  }
  const {
    records,
    playerMatchRecords,
    matchStageTimeRecord,
    room,
    ...restDetail
  } = detail
  response.success(ctx, {
    ...restDetail,
    tableType: room.tableType,
    initialChips: room.initialChips,
    sevenTwoBonusEnabled: room.sevenTwoBonusEnabled,
    startedAt: formatTime(detail.startedAt),
    endedAt: formatTime(detail.endedAt),
    stageRecords: matchStageTimeRecord.map((record) => {
      return {
        ...record,
        endAt: formatTime(record.endAt),
        startAt: formatTime(record.startAt)
      }
    }),
    settleRecords: projectSettleRecordsForMatchDetail(playerMatchRecords, {
      viewerUserId: userId,
      matchEnded: detail.endedAt != null
    }),
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
    response.error(ctx, HTTP_STATUS.BAD_REQUEST, '参数错误')
    return
  }
  const access = await assertMatchSensitiveAccess(ctx, id)
  if (!access) return

  const list = await engineFatalIncident.findMany({
    where: { matchId: id },
    orderBy: { createdAt: 'desc' }
  })
  response.success(ctx, {
    list: list.map((item) => ({
      id: item.id,
      roomId: item.roomId,
      matchId: item.matchId,
      message: item.message,
      payload: item.payload,
      createdAt: formatTime(item.createdAt)
    }))
  })
})

router.post(matchWebApi('/records/:matchId'), async (ctx) => {
  const matchId = Number(ctx.params.matchId)

  if (isNaN(matchId)) {
    response.error(ctx, HTTP_STATUS.BAD_REQUEST, '参数错误')
    return
  }
  const access = await assertMatchSensitiveAccess(ctx, matchId)
  if (!access) return

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
    response.error(ctx, HTTP_STATUS.BAD_REQUEST, '参数错误')
    return
  }
  const access = await assertMatchSensitiveAccess(ctx, matchId)
  if (!access) return

  const list = await playerMatchRecord.findMany({
    where: {
      matchId
    },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          avatarUrl: true,
          avatarKey: true,
          pokerBackgroundKey: true,
          tableBackgroundKey: true,
          balance: true,
          username: true,
          createdAt: true
        }
      }
    }
  })
  response.success(ctx, { list })
})

/** 管理员：从 DB 磁带重放并返回 Core 复合读模型（含底牌等敏感字段，勿对非管理员开放） */
router.post(matchWebApi('/replay-composite/:matchId'), async (ctx) => {
  const userId = ctx.state.user?.id
  const matchId = Number(ctx.params.matchId)
  if (!userId) {
    response.error(ctx, HTTP_STATUS.UNAUTHORIZED, '身份凭证无效, 请重新登陆')
    return
  }
  if (isNaN(matchId)) {
    response.error(ctx, HTTP_STATUS.BAD_REQUEST, '参数错误')
    return
  }
  const loginUser = await user.findUnique({
    where: { id: userId },
    select: { isAdmin: true }
  })
  if (!loginUser?.isAdmin) {
    response.error(ctx, HTTP_STATUS.FORBIDDEN, '无权限')
    return
  }
  try {
    const { tapeIssues, compositeReadModel } =
      await loadMatchCompositeReadModelFromDbTape(matchId)
    response.success(ctx, { tapeIssues, compositeReadModel })
  } catch (err) {
    logger.error('[match/replay-composite] failed', err)
    response.error(ctx, HTTP_STATUS.INTERNAL_SERVER_ERROR, '回放投影失败')
  }
})
