import type { ParameterizedContext } from 'koa'

import dayjs from 'dayjs'
import { isEmpty } from 'ramda'
import {
  Prisma,
  AnnouncementType,
  AnnouncementStatus
} from '@prisma/texas-client'

import response from '../../utils/response'
import { announcement } from '../../models'
import combinePath from '../../utils/combinePath'
import router, { type DefaultState } from '../instance'
import { timeFormat, apiPrefixWeb, apiPrefixClient } from '../../config'

const announcementApiClient = combinePath(apiPrefixClient)('/announcement')
const announcementApiWeb = combinePath(apiPrefixWeb)('/announcement')
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

/** 有结束时间时，必须严格晚于发布时间 */
const validateExpireAfterPublish = (
  publishAt: Date,
  expireAt: Date | null
): string | null => {
  if (expireAt == null) return null
  if (expireAt.getTime() <= publishAt.getTime()) {
    return '过期时间必须晚于发布时间'
  }
  return null
}

/** priority 统一解析：未传默认 0，传值需可转为数字 */
const parsePriority = (value: unknown): number => {
  if (value === undefined || value === null || value === '') return 0
  const parsed = typeof value === 'number' ? value : Number(value)
  if (Number.isNaN(parsed)) throw new Error('priority 格式异常')
  return Math.trunc(parsed)
}

/**
 * 查询当前有效公告列表：
 * 规则：
 * - status: published
 * - publishAt <= now
 * - expireAt 为 null 或 expireAt >= now
 * - 排序：priority desc，priority 相同按 publishAt desc
 */
async function handleValidAnnouncementsList(
  ctx: ParameterizedContext<DefaultState>
) {
  const nowDate = new Date()

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
      expireAt: true,
      createdAt: true,
      updatedAt: true
    },
    orderBy: [{ priority: 'desc' }, { publishAt: 'desc' }]
  })

  const formattedList = list.map((item) => ({
    ...item,
    publishAt: dayjs(item.publishAt).format(timeFormat),
    createdAt: dayjs(item.createdAt).format(timeFormat),
    updatedAt: dayjs(item.updatedAt).format(timeFormat)
  }))

  response.success(ctx, formattedList, '查询成功')
}

// 客户端：查询当前有效的所有公告
router.post(announcementApiClient('/validList'), async (ctx) => {
  await handleValidAnnouncementsList(ctx)
})

// Web 端（用户）：查询当前有效的所有公告，返回与 client/validList 一致
router.post(announcementApiWeb('/validList'), async (ctx) => {
  await handleValidAnnouncementsList(ctx)
})

const ANNOUNCEMENT_TYPES = new Set<AnnouncementType>(
  Object.values(AnnouncementType)
)
const ANNOUNCEMENT_STATUSES = new Set<AnnouncementStatus>(
  Object.values(AnnouncementStatus)
)
const isAnnouncementType = (value: unknown): value is AnnouncementType =>
  typeof value === 'string' && ANNOUNCEMENT_TYPES.has(value as AnnouncementType)
const isAnnouncementStatus = (value: unknown): value is AnnouncementStatus =>
  typeof value === 'string' &&
  ANNOUNCEMENT_STATUSES.has(value as AnnouncementStatus)

/**
 * Web 端公告列表（分页，未删除的全部记录；需管理员）
 *
 * body: {
 *   current?: number,     // 默认 1
 *   pageSize?: number,    // 默认 20，最大 100
 *   type?: AnnouncementType,
 *   status?: AnnouncementStatus,
 *   title?: string,       // 模糊匹配 title
 *   summary?: string,     // 模糊匹配 summary
 *   content?: string,     // 模糊匹配 content
 *   publishAt?: number | string,      // 发布起始时间（>=）
 *   expireAt?: number | string        // 发布结束时间（<=）
 * }
 */
router.post(announcementApiWeb('/list'), async (ctx) => {
  const body = (ctx.request.body ?? {}) as Record<string, unknown>
  const {
    current: pageRaw,
    pageSize: pageSizeRaw,
    type,
    status,
    title,
    summary,
    content,
    publishAt,
    expireAt
  } = body

  const page = Math.max(1, Math.trunc(Number(pageRaw) || 1))
  const pageSize = Math.min(
    100,
    Math.max(1, Math.trunc(Number(pageSizeRaw) || 20))
  )

  if (
    type !== undefined &&
    type !== null &&
    type !== '' &&
    !isAnnouncementType(type)
  ) {
    response.error(ctx, 400, 'type 不合法')
    return
  }
  if (
    status !== undefined &&
    status !== null &&
    status !== '' &&
    !isAnnouncementStatus(status)
  ) {
    response.error(ctx, 400, 'status 不合法')
    return
  }

  let publishAtDate: Date | null = null
  let expireAtDate: Date | null = null
  try {
    if (publishAt !== undefined && publishAt !== null && publishAt !== '') {
      publishAtDate = parseToDate(publishAt, 'publishAt')
    }
    if (expireAt !== undefined && expireAt !== null && expireAt !== '') {
      expireAtDate = parseToDate(expireAt, 'expireAt')
    }
  } catch (e) {
    response.error(ctx, 400, e instanceof Error ? e.message : '参数异常')
    return
  }

  const where: Prisma.AnnouncementWhereInput = {
    deletedAt: null
  }

  if (isAnnouncementType(type)) {
    where.type = type
  }
  if (isAnnouncementStatus(status)) {
    where.status = status
  }

  if (typeof title === 'string' && title.trim().length > 0) {
    where.title = { contains: title.trim() }
  }
  if (typeof summary === 'string' && summary.trim().length > 0) {
    where.summary = { contains: summary.trim() }
  }
  if (typeof content === 'string' && content.trim().length > 0) {
    where.content = { contains: content.trim() }
  }

  if (publishAtDate || expireAtDate) {
    where.publishAt = {}
    if (publishAtDate) {
      where.publishAt.gte = publishAtDate
    }
    if (expireAtDate) {
      where.publishAt.lte = expireAtDate
    }
  }

  const [total, list] = await Promise.all([
    announcement.count({ where }),
    announcement.findMany({
      where,
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
        expireAt: true,
        createdAt: true,
        updatedAt: true,
        deletedAt: true
      },
      orderBy: [{ priority: 'desc' }, { publishAt: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize
    })
  ])

  const formattedList = list.map((item) => ({
    ...item,
    publishAt: dayjs(item.publishAt).format(timeFormat),
    expireAt: item.expireAt ? dayjs(item.expireAt).format(timeFormat) : null,
    createdAt: dayjs(item.createdAt).format(timeFormat),
    updatedAt: dayjs(item.updatedAt).format(timeFormat),
    deletedAt: item.deletedAt ? dayjs(item.deletedAt).format(timeFormat) : null
  }))

  response.success(
    ctx,
    {
      list: formattedList,
      total,
      current: page,
      pageSize
    },
    '查询成功'
  )
})

/**
 * 公告详情
 * body: { id: number }
 */
router.post(announcementApiWeb('/detail'), async (ctx) => {
  const { id } = ctx.request.body ?? {}
  if (!id) {
    response.error(ctx, 400, '参数异常')
    return
  }

  const data = await announcement.findFirst({
    where: {
      id: Number(id),
      deletedAt: null
    }
  })

  if (!data) {
    response.error(ctx, 404, '公告不存在')
    return
  }

  response.success(
    ctx,
    {
      ...data,
      publishAt: dayjs(data.publishAt).format(timeFormat),
      expireAt: data.expireAt ? dayjs(data.expireAt).format(timeFormat) : null,
      createdAt: dayjs(data.createdAt).format(timeFormat),
      updatedAt: dayjs(data.updatedAt).format(timeFormat),
      deletedAt: data.deletedAt
        ? dayjs(data.deletedAt).format(timeFormat)
        : null
    },
    '查询成功'
  )
})

/**
 * 更新公告
 * body: {
 *   id: number,
 *   title, summary, content,
 *   publishAt, expireAt?,
 *   priority?,
 *   actionText?, actionUrl?
 *   其中 id/title/summary/content/publishAt 必传；
 *   expireAt 未传时按 null 处理；若有 expireAt（非空）则必须晚于 publishAt
 * }
 */
router.post(announcementApiWeb('/update'), async (ctx) => {
  const {
    id,
    title,
    summary,
    content,
    publishAt,
    expireAt,
    priority,
    actionText,
    actionUrl
  } = (ctx.request.body ?? {}) as Record<string, unknown>

  if ([id, title, summary, content, publishAt].some((value) => !value)) {
    response.error(ctx, 400, '参数异常')
    return
  }
  const idNum = Number(id)
  if (Number.isNaN(idNum)) {
    response.error(ctx, 400, 'id 格式异常')
    return
  }

  const data: Prisma.AnnouncementUpdateInput = {}
  const [titleText, summaryText, contentText] = [title, summary, content].map(
    (item) => String(item).trim()
  )
  if ([titleText, summaryText, contentText].some(isEmpty)) {
    response.error(ctx, 400, '参数异常')
    return
  }
  data.title = titleText
  data.summary = summaryText
  data.content = contentText
  data.actionText =
    actionText === undefined || actionText === null || actionText === ''
      ? null
      : String(actionText).trim()
  data.actionUrl =
    actionUrl === undefined || actionUrl === null || actionUrl === ''
      ? null
      : String(actionUrl).trim()

  try {
    data.priority = parsePriority(priority)
  } catch (e) {
    response.error(ctx, 400, e instanceof Error ? e.message : '参数异常')
    return
  }

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
  const timeErr = validateExpireAfterPublish(publishAtDate, expireAtDate)
  if (timeErr) {
    response.error(ctx, 400, timeErr)
    return
  }
  data.publishAt = publishAtDate
  data.expireAt = { set: expireAtDate }

  const exists = await announcement.findFirst({
    where: { id: idNum, deletedAt: null },
    select: { id: true }
  })
  if (!exists) {
    response.error(ctx, 404, '公告不存在')
    return
  }

  const updated = await announcement.update({
    where: { id: idNum },
    data
  })

  response.success(ctx, updated, '公告更新成功')
})

/**
 * 创建公告
 * body: {
 *  type, title, summary, content,
 *  actionText?, actionUrl?,
 *  priority?, status?('published'|'disabled'),
 *  publishAt（必填）, expireAt?
 *  若 expireAt 有值，必须晚于 publishAt
 * }
 */
router.post(announcementApiWeb('/create'), async (ctx) => {
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
  if ([type, title, summary, content, publishAt].some((value) => !value)) {
    response.error(ctx, 400, '参数异常')
    return
  }

  if (!isAnnouncementType(type)) {
    response.error(ctx, 400, 'type 不合法')
    return
  }

  const [titleText, summaryText, contentText] = [title, summary, content].map(
    (item) => String(item).trim()
  )
  if ([titleText, summaryText, contentText].some(isEmpty)) {
    response.error(ctx, 400, '参数异常')
    return
  }

  const announcementType = type

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

  const createTimeErr = validateExpireAfterPublish(publishAtDate, expireAtDate)
  if (createTimeErr) {
    response.error(ctx, 400, createTimeErr)
    return
  }

  const createStatus: AnnouncementStatus =
    status === 'disabled' ? 'disabled' : 'published'
  let priorityValue = 0
  try {
    priorityValue = parsePriority(priority)
  } catch (e) {
    response.error(ctx, 400, e instanceof Error ? e.message : '参数异常')
    return
  }

  const created = await announcement.create({
    data: {
      title: titleText,
      summary: summaryText,
      content: contentText,
      type: announcementType,
      actionText:
        actionText === undefined || actionText === null || actionText === ''
          ? null
          : String(actionText).trim(),
      actionUrl:
        actionUrl === undefined || actionUrl === null || actionUrl === ''
          ? null
          : String(actionUrl).trim(),
      priority: priorityValue,
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
router.post(announcementApiWeb('/changeStatus'), async (ctx) => {
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

/**
 * 删除公告（软删除）
 * body: { id: number }
 * 规则：已发布状态不可删除（业务错误码 2000）
 */
router.post(announcementApiWeb('/delete'), async (ctx) => {
  const { id } = ctx.request.body ?? {}
  if (!id) {
    response.error(ctx, 400, '参数异常')
    return
  }

  const target = await announcement.findFirst({
    where: { id: Number(id), deletedAt: null },
    select: { id: true, status: true }
  })
  if (!target) {
    response.error(ctx, 404, '公告不存在')
    return
  }

  if (target.status === 'published') {
    response.error(ctx, 2000, '已发布公告不可删除')
    return
  }

  const deleted = await announcement.update({
    where: { id: Number(id) },
    data: { deletedAt: new Date() }
  })

  response.success(ctx, deleted, '删除成功')
})
