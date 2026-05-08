/**
 * Web 管理端：用户只读运维（列表 / 详情，不含密码等敏感字段）
 */
import { Prisma } from '@prisma/texas-client'

import router from './instance'
import { user } from '../models'
import { apiPrefixWeb } from '../config'
import { assertWebAdmin } from './webAuth'
import formatTime from '../utils/formatTime'
import combinePath from '../utils/combinePath'
import { HTTP_STATUS } from '../constants/httpStatus'
import response, { withList } from '../utils/response'

const userOpsWebApi = combinePath(apiPrefixWeb)('/user-ops')

router.post(userOpsWebApi('/list'), async (ctx) => {
  if ((await assertWebAdmin(ctx)) == null) return

  const {
    current: page,
    pageSize: take,
    q,
    includeDeleted
  } = (ctx.request.body ?? {}) as {
    current?: number
    pageSize?: number
    q?: string
    includeDeleted?: boolean
  }
  if (!page || !take) {
    response.error(ctx, HTTP_STATUS.BAD_REQUEST, '分页参数错误')
    return
  }

  const where: Prisma.UserWhereInput = {}
  if (!includeDeleted) {
    where.deletedAt = null
  }
  const trimmed = typeof q === 'string' ? q.trim() : ''
  if (trimmed) {
    where.OR = [
      { name: { contains: trimmed } },
      { username: { contains: trimmed } }
    ]
  }

  const skip = (page - 1) * take
  const [total, rows] = await Promise.all([
    user.count({ where }),
    user.findMany({
      where,
      skip,
      take,
      orderBy: { id: 'desc' },
      select: {
        id: true,
        name: true,
        username: true,
        balance: true,
        avatarUrl: true,
        avatarKey: true,
        pokerBackgroundKey: true,
        tableBackgroundKey: true,
        weChatId: true,
        isAdmin: true,
        createdAt: true,
        updatedAt: true,
        deletedAt: true,
        _count: {
          select: { matchRecords: true }
        }
      }
    })
  ])

  response.success(
    ctx,
    withList(
      rows.map(({ _count, ...r }) => ({
        ...r,
        matchRecordsCount: _count.matchRecords,
        createdAt: formatTime(r.createdAt),
        updatedAt: formatTime(r.updatedAt),
        deletedAt: formatTime(r.deletedAt)
      })),
      total
    )
  )
})

router.post(userOpsWebApi('/detail'), async (ctx) => {
  if ((await assertWebAdmin(ctx)) == null) return

  const { userId } = (ctx.request.body ?? {}) as { userId?: number }
  if (userId == null || !Number.isInteger(userId) || userId <= 0) {
    response.error(ctx, HTTP_STATUS.BAD_REQUEST, 'userId 参数错误')
    return
  }

  const row = await user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      username: true,
      balance: true,
      avatarUrl: true,
      avatarKey: true,
      pokerBackgroundKey: true,
      tableBackgroundKey: true,
      weChatId: true,
      isAdmin: true,
      createdAt: true,
      updatedAt: true,
      deletedAt: true,
      settings: {
        select: {
          showHistoryRecords: true,
          showRecordOverview: true,
          autoCallOnOffline: true,
          createdAt: true,
          updatedAt: true
        }
      },
      _count: {
        select: {
          matchRecords: true,
          Room: true,
          roomMembers: true,
          roomChipTopUps: true,
          userRoomStats: true
        }
      }
    }
  })
  if (!row) {
    response.error(ctx, HTTP_STATUS.NOT_FOUND, '用户不存在')
    return
  }

  response.success(ctx, {
    ...row,
    matchRecordsCount: row._count.matchRecords,
    createdAt: formatTime(row.createdAt),
    updatedAt: formatTime(row.updatedAt),
    deletedAt: formatTime(row.deletedAt),
    settings: row.settings
      ? {
          ...row.settings,
          createdAt: formatTime(row.settings.createdAt),
          updatedAt: formatTime(row.settings.updatedAt)
        }
      : null
  })
})
