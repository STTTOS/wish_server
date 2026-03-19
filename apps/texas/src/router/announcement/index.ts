import type { AnnouncementType, AnnouncementStatus } from '@prisma/texas-client'

import dayjs from 'dayjs'
import { isNil } from 'ramda'

import router from '../instance'
import response from '../../utils/response'
import { announcement } from '../../models'
import { apiPrefixClient } from '../../config'
import combinePath from '../../utils/combinePath'

const announcementApiClient = combinePath(apiPrefixClient)('/announcement')

const parseToDate = (value: unknown, fieldName: string) => {
  if (value === null || value === undefined) return null
  if (value instanceof Date) return value

  if (typeof value === 'number') {
    // 兼容秒级时间戳（通常 < 1e12）
    const ms = value < 1_000_000_000_000 ? value * 1000 : value
    const date = new Date(ms)
    if (Number.isNaN(date.getTime())) {
      throw new Error(`${fieldName} 格式异常`)
    }
    return date
  }

  const stringValue = typeof value === 'string' ? value : String(value)
  const date = new Date(stringValue)
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${fieldName} 格式异常`)
  }
  return date
}

/**
 * 查询公告列表：
 * 入参：{ now: number | string }
 * 规则：
 * - status: published
 * - publishAt <= now
 * - expireAt 为 null 或 expireAt >= now
 * - 排序：priority desc，priority 相同按 publishAt desc
 */
router.post(announcementApiClient('/list'), async (ctx) => {
  const { now } = ctx.request.body ?? {}
  let nowDate: Date | null = null
  try {
    nowDate = parseToDate(now, 'now')
  } catch (e) {
    response.error(ctx, 400, e instanceof Error ? e.message : '参数异常')
    return
  }

  if (!nowDate) {
    response.error(ctx, 400, 'now 不可为空')
    return
  }

  const list = await announcement.findMany({
    where: {
      deletedAt: null,
      status: 'published',
      publishAt: { lte: nowDate },
      OR: [{ expireAt: null }, { expireAt: { gte: nowDate } }]
    },
    select: {
      id: true,
      type: true,
      title: true,
      summary: true,
      content: true,
      actionText: true,
      actionUrl: true,
      priority: true,
      status: true,
      publishAt: true,
      expireAt: true
    },
    orderBy: [{ priority: 'desc' }, { publishAt: 'desc' }]
  })

  const formattedList = list.map((item) => ({
    ...item,
    publishAt: dayjs(item.publishAt).format('YYYY-MM-DD')
  }))

  response.success(ctx, formattedList, '查询成功')
})

/**
 * 创建公告
 * body: {
 *  type, title, summary, content,
 *  actionText?, actionUrl?,
 *  priority?, status?('published'|'disabled'),
 *  publishAt, expireAt?
 * }
 */
router.post(announcementApiClient('/create'), async (ctx) => {
  const {
    type,
    title,
    summary,
    content,
    actionText,
    actionUrl,
    priority,
    status,
    publishAt,
    expireAt
  } = ctx.request.body ?? {}

  // type 需要是 Prisma 枚举值，运行时无法完全校验，至少保证必填字段存在
  if ([type, title, summary, content, publishAt].some(isNil)) {
    response.error(ctx, 400, '参数异常')
    return
  }

  const allowedTypes = new Set(['activity', 'update', 'maintenance'])
  if (typeof type !== 'string' || !allowedTypes.has(type)) {
    response.error(ctx, 400, 'type 不合法')
    return
  }

  const announcementType = type as AnnouncementType

  let publishAtDate: Date | null = null
  let expireAtDate: Date | null = null
  try {
    publishAtDate = parseToDate(publishAt, 'publishAt')
    expireAtDate = parseToDate(expireAt, 'expireAt')
  } catch (e) {
    response.error(ctx, 400, e instanceof Error ? e.message : '参数异常')
    return
  }

  if (!publishAtDate) {
    response.error(ctx, 400, 'publishAt 不可为空')
    return
  }

  const createStatus: AnnouncementStatus =
    status === 'disabled' ? 'disabled' : 'published'
  let priorityValue = 0
  if (priority !== undefined && priority !== null && priority !== '') {
    priorityValue = typeof priority === 'number' ? priority : Number(priority)
  }

  const created = await announcement.create({
    data: {
      title,
      summary,
      content,
      type: announcementType,
      actionText:
        actionText === undefined || actionText === null || actionText === ''
          ? null
          : String(actionText).trim(),
      actionUrl:
        actionUrl === undefined || actionUrl === null || actionUrl === ''
          ? null
          : String(actionUrl).trim(),
      priority: Number.isNaN(priorityValue) ? 0 : Math.trunc(priorityValue),
      status: createStatus,
      publishAt: publishAtDate,
      expireAt: expireAtDate
    }
  })

  response.success(ctx, created, '公告创建成功')
})

/**
 * 上架/下架
 * body: { id: number, status: 'published' | 'disabled' }
 */
router.post(announcementApiClient('/changeStatus'), async (ctx) => {
  const { id, status } = ctx.request.body ?? {}

  if (!id || (status !== 'published' && status !== 'disabled')) {
    response.error(ctx, 400, '参数异常')
    return
  }

  const updated = await announcement.update({
    where: { id: Number(id) },
    data: { status }
  })

  response.success(ctx, updated, '状态更新成功')
})
