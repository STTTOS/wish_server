/**
 * Web 管理端：单局 MatchDomainEvent 磁带只读浏览（分页，按 id 升序）
 */
import { Prisma } from '@prisma/texas-client'

import router from './instance'
import { apiPrefixWeb } from '../config'
import { assertWebAdmin } from './webAuth'
import formatTime from '../utils/formatTime'
import combinePath from '../utils/combinePath'
import { match, matchDomainEvent } from '../models'
import { ROOM_TABLE_TYPES } from '../constants/game'
import { HTTP_STATUS } from '../constants/httpStatus'
import response, { withList } from '../utils/response'

const tapeWebApi = combinePath(apiPrefixWeb)('/match-domain-event')

router.post(tapeWebApi('/list'), async (ctx) => {
  if ((await assertWebAdmin(ctx)) == null) return

  const {
    matchId,
    current: page,
    pageSize: take,
    tableType,
    eventType
  } = (ctx.request.body ?? {}) as {
    matchId?: number
    current?: number
    pageSize?: number
    /** 与对局所在房间 `room.tableType` 一致时才可查；不传或 `all` 则不校验 */
    tableType?: string
    eventType?: string
  }

  if (matchId == null || !Number.isInteger(matchId) || matchId <= 0) {
    response.error(ctx, HTTP_STATUS.BAD_REQUEST, 'matchId 参数错误')
    return
  }
  if (!page || !take) {
    response.error(ctx, HTTP_STATUS.BAD_REQUEST, '分页参数错误')
    return
  }

  if (
    tableType &&
    tableType !== 'all' &&
    !(ROOM_TABLE_TYPES as readonly string[]).includes(tableType)
  ) {
    response.error(ctx, HTTP_STATUS.BAD_REQUEST, 'tableType 参数异常')
    return
  }

  const matchRow = await match.findUnique({
    where: { id: matchId },
    select: {
      id: true,
      room: { select: { tableType: true } }
    }
  })
  if (!matchRow) {
    response.error(ctx, HTTP_STATUS.NOT_FOUND, '对局不存在')
    return
  }

  if (
    tableType &&
    tableType !== 'all' &&
    matchRow.room.tableType !== tableType
  ) {
    response.error(
      ctx,
      HTTP_STATUS.BAD_REQUEST,
      '对局所在桌型与所选 tableType 不一致'
    )
    return
  }

  const where: Prisma.MatchDomainEventWhereInput = { matchId }
  if (eventType != null && eventType.trim() !== '') {
    where.eventType = { contains: eventType.trim() }
  }

  const skip = (page - 1) * take
  const [total, rows] = await Promise.all([
    matchDomainEvent.count({ where }),
    matchDomainEvent.findMany({
      where,
      orderBy: { id: 'asc' },
      skip,
      take,
      select: {
        id: true,
        matchId: true,
        roomId: true,
        handId: true,
        seq: true,
        eventType: true,
        payload: true,
        createdAt: true
      }
    })
  ])

  response.success(
    ctx,
    withList(
      rows.map((r) => ({
        ...r,
        createdAt: formatTime(r.createdAt)
      })),
      total
    )
  )
})
