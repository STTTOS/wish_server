import { Prisma } from '@prisma/texas-client'

import router from '../instance'
import { apiPrefixWeb } from '../../config'
import combinePath from '../../utils/combinePath'
import { user, playerMatchRecord } from '../../models'
import { HTTP_STATUS } from '../../constants/httpStatus'
import response, { withList } from '../../utils/response'
import { WEB_ADMIN_LIST_MAX_PAGE_SIZE } from '../../constants/pagination'
import { clampPaginationBody } from '../../middleware/clampPaginationBody'
import {
  pokeDistributionDetailItems,
  aggregateHandPokeAuditFromRows
} from './handPokeAuditService'

const matchWebApi = combinePath(apiPrefixWeb)('/match')

/**
 * 手牌分布审计列表（不含 pokeDistribution）。管理员权限由 `ADMIN_ONLY_PATHS` + customHandle403。
 * body: { current: number, pageSize: number, name?: string } — name 模糊匹配昵称
 */
router.post(
  matchWebApi('/hand-poke-audit/list'),
  clampPaginationBody({ maxPageSize: WEB_ADMIN_LIST_MAX_PAGE_SIZE }),
  async (ctx) => {
    const body = ctx.request.body as {
      current?: unknown
      pageSize?: unknown
      name?: unknown
    }
    const current = Number(body?.current)
    const pageSize = Number(body?.pageSize)
    if (!current || !pageSize || current < 1 || pageSize < 1) {
      response.error(ctx, HTTP_STATUS.BAD_REQUEST, '分页参数错误')
      return
    }

    const nameRaw = body?.name
    const nameTrim = typeof nameRaw === 'string' ? nameRaw.trim() : ''

    const userWhere: Prisma.UserWhereInput = {
      deletedAt: null
    }
    if (nameTrim.length > 0) {
      userWhere.name = { contains: nameTrim }
    }

    const skip = (current - 1) * pageSize

    const [total, users] = await Promise.all([
      user.count({ where: userWhere }),
      user.findMany({
        where: userWhere,
        skip,
        take: pageSize,
        select: {
          id: true,
          name: true,
          avatarUrl: true,
          avatarKey: true
        },
        orderBy: { id: 'asc' }
      })
    ])

    if (users.length === 0) {
      response.success(ctx, withList([], total))
      return
    }

    const userIds = users.map((u) => u.id)
    const records = await playerMatchRecord.findMany({
      where: { userId: { in: userIds } },
      select: { userId: true, handPokes: true }
    })

    const recordsByUser = new Map<number, { handPokes: unknown }[]>()
    for (const uid of userIds) {
      recordsByUser.set(uid, [])
    }
    for (const r of records) {
      recordsByUser.get(r.userId)?.push({ handPokes: r.handPokes })
    }

    const list = users.map((u) => {
      const rows = recordsByUser.get(u.id) ?? []
      const agg = aggregateHandPokeAuditFromRows(rows)
      return {
        userId: u.id,
        name: u.name,
        avatarKey: u.avatarKey,
        avatarUrl: u.avatarUrl,
        /** 有效两手记录数（无效 handPokes 已忽略，一般为改库才会出现） */
        handCount: agg.validHandCount,
        auditStatus: agg.auditStatus,
        chiSquare: agg.chiSquare,
        pValue: agg.pValue
      }
    })

    response.success(ctx, withList(list, total))
  }
)

/**
 * 手牌审计详情（含 52 项 pokeDistribution）。管理员权限由 middleware 统一校验。
 * body: { userId: number }
 */
router.post(matchWebApi('/hand-poke-audit/detail'), async (ctx) => {
  const body = ctx.request.body as { userId?: unknown }
  const targetUserId = Number(body?.userId)
  if (!Number.isInteger(targetUserId) || targetUserId < 1) {
    response.error(ctx, HTTP_STATUS.BAD_REQUEST, '参数异常：需要合法 userId')
    return
  }

  const target = await user.findFirst({
    where: { id: targetUserId, deletedAt: null },
    select: {
      id: true,
      name: true,
      avatarUrl: true,
      avatarKey: true
    }
  })
  if (!target) {
    response.error(ctx, HTTP_STATUS.NOT_FOUND, '用户不存在')
    return
  }

  const rows = await playerMatchRecord.findMany({
    where: { userId: targetUserId },
    select: { handPokes: true }
  })

  const agg = aggregateHandPokeAuditFromRows(rows)
  const pokeDistribution = pokeDistributionDetailItems(
    agg.countsByPoke,
    agg.totalValidCards
  )

  response.success(ctx, {
    userId: target.id,
    name: target.name,
    avatarKey: target.avatarKey,
    avatarUrl: target.avatarUrl,
    handCount: agg.validHandCount,
    cardCount: agg.totalValidCards,
    auditStatus: agg.auditStatus,
    chiSquare: agg.chiSquare,
    pValue: agg.pValue,
    /** 为 true 时建议启用绿→黄→红渐变；样本不足时仅展示原始次数即可 */
    heatmapScaleEnabled: agg.heatmapScaleEnabled,
    pokeDistribution
  })
})
