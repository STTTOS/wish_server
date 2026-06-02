import type { ParameterizedContext } from 'koa'

import dayjs from 'dayjs'
import { isEmpty } from 'ramda'
import {
  Prisma,
  AnnouncementType,
  AnnouncementStatus
} from '@prisma/texas-client'

import response from '../../utils/response'
import combinePath from '../../utils/combinePath'
import router, { type DefaultState } from '../instance'
import { HTTP_STATUS } from '../../constants/httpStatus'
import { announcement, announcementRead } from '../../models'
import { timeFormat, apiPrefixWeb, apiPrefixClient } from '../../config'
import {
  matchesAnnouncementClientVersion,
  parseAnnouncementClientVersionRange
} from '../../utils/announcementClientVersion'

const announcementApiClient = combinePath(apiPrefixClient)('/announcement')
const announcementApiWeb = combinePath(apiPrefixWeb)('/announcement')

const announcementVersionSelect = {
  minClientVersion: true,
  maxClientVersion: true
} as const

const readClientVersionFromBody = (body: unknown): string | undefined => {
  if (body == null || typeof body !== 'object' || Array.isArray(body)) {
    return undefined
  }
  const raw = (body as Record<string, unknown>).version
  if (typeof raw === 'string' && raw.trim() !== '') {
    return raw.trim()
  }
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return String(raw)
  }
  return undefined
}

const filterAnnouncementsByClientVersion = <
  T extends { minClientVersion: string | null; maxClientVersion: string | null }
>(
  list: T[],
  clientVersion?: string
): T[] => {
  if (clientVersion == null) return list
  return list.filter((item) =>
    matchesAnnouncementClientVersion(
      {
        minClientVersion: item.minClientVersion,
        maxClientVersion: item.maxClientVersion
      },
      clientVersion
    )
  )
}
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
  ctx: ParameterizedContext<DefaultState>,
  userId?: number,
  onlyUnread = false,
  clientVersion?: string
) {
  const nowDate = new Date()
  const readWhere = userId ? { userId } : undefined

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
      updatedAt: true,
      ...announcementVersionSelect,
      reads: readWhere
        ? {
            where: readWhere,
            select: { id: true },
            take: 1
          }
        : false
    },
    orderBy: [{ priority: 'desc' }, { publishAt: 'desc' }]
  })

  const versionFilteredList = filterAnnouncementsByClientVersion(
    list,
    clientVersion
  )

  const filteredList = onlyUnread
    ? versionFilteredList.filter(
        (item) => !item.reads || item.reads.length === 0
      )
    : versionFilteredList

  const formattedList = filteredList.map(
    ({ publishAt, expireAt, createdAt, updatedAt, reads, ...rest }) => ({
      ...rest,
      isRead: Boolean(reads && reads.length > 0),
      publishAt: dayjs(publishAt).format(timeFormat),
      expireAt: expireAt ? dayjs(expireAt).format(timeFormat) : null,
      createdAt: dayjs(createdAt).format(timeFormat),
      updatedAt: dayjs(updatedAt).format(timeFormat)
    })
  )

  response.success(ctx, formattedList, '查询成功')
}

// 客户端：查询当前有效的所有公告, 需要返回是否已读
router.post(announcementApiClient('/validList'), async (ctx) => {
  const userId = ctx.state.user!.id
  const body = (ctx.request.body ?? {}) as {
    onlyUnread?: boolean
    version?: unknown
  }
  const { onlyUnread = false } = body
  const clientVersion = readClientVersionFromBody(body)

  await handleValidAnnouncementsList(ctx, userId, onlyUnread, clientVersion)
})

// Web 端（用户）：查询当前有效的所有公告，返回与 client/validList 一致
router.post(announcementApiWeb('/validList'), async (ctx) => {
  await handleValidAnnouncementsList(ctx)
})

/**
 * 客户端：标记公告为已读（防重复写入）
 * body: { announcementId: number }
 */
router.post(announcementApiClient('/markRead'), async (ctx) => {
  const userId = ctx.state.user?.id
  if (!userId) {
    response.error(ctx, HTTP_STATUS.UNAUTHORIZED, '身份凭证无效, 请重新登陆')
    return
  }

  const { announcementId } = (ctx.request.body ?? {}) as {
    announcementId?: number | string
  }
  if (!announcementId) {
    response.error(ctx, HTTP_STATUS.BAD_REQUEST, '参数异常')
    return
  }
  const announcementIdNum = Number(announcementId)
  if (Number.isNaN(announcementIdNum)) {
    response.error(ctx, HTTP_STATUS.BAD_REQUEST, 'announcementId 格式异常')
    return
  }

  const nowDate = new Date()
  const clientVersion = readClientVersionFromBody(ctx.request.body)
  const exists = await announcement.findFirst({
    where: {
      id: announcementIdNum,
      deletedAt: null,
      status: 'published',
      publishAt: { lte: nowDate },
      OR: [{ expireAt: null }, { expireAt: { gte: nowDate } }]
    },
    select: { id: true, ...announcementVersionSelect }
  })
  if (
    !exists ||
    (clientVersion != null &&
      !matchesAnnouncementClientVersion(exists, clientVersion))
  ) {
    response.error(ctx, HTTP_STATUS.NOT_FOUND, '公告不存在或已失效')
    return
  }

  await announcementRead.upsert({
    where: {
      // eslint-disable-next-line camelcase
      announcementId_userId: {
        announcementId: announcementIdNum,
        userId
      }
    },
    create: {
      announcementId: announcementIdNum,
      userId
    },
    update: {
      readAt: nowDate
    }
  })

  response.success(ctx, null, '标记已读成功')
})

/**
 * 客户端：批量标记公告为已读（防重复写入）
 * body: { announcementIds: number[] }
 */
router.post(announcementApiClient('/markReadBatch'), async (ctx) => {
  const userId = ctx.state.user!.id

  const { announcementIds } = (ctx.request.body ?? {}) as {
    announcementIds?: Array<number | string>
  }
  if (!Array.isArray(announcementIds) || announcementIds.length === 0) {
    response.error(ctx, HTTP_STATUS.BAD_REQUEST, '参数异常')
    return
  }

  const idSet = new Set<number>()
  for (const id of announcementIds) {
    const idNum = Number(id)
    if (!Number.isInteger(idNum) || idNum <= 0) {
      response.error(ctx, HTTP_STATUS.BAD_REQUEST, 'announcementIds 格式异常')
      return
    }
    idSet.add(idNum)
  }
  const dedupedIds = Array.from(idSet)

  const nowDate = new Date()
  const clientVersion = readClientVersionFromBody(ctx.request.body)
  const validAnnouncements = await announcement.findMany({
    where: {
      id: { in: dedupedIds },
      deletedAt: null,
      status: 'published',
      publishAt: { lte: nowDate },
      OR: [{ expireAt: null }, { expireAt: { gte: nowDate } }]
    },
    select: { id: true, ...announcementVersionSelect }
  })
  const validIds = filterAnnouncementsByClientVersion(
    validAnnouncements,
    clientVersion
  ).map((item) => item.id)
  if (validIds.length === 0) {
    response.error(ctx, HTTP_STATUS.NOT_FOUND, '公告不存在或已失效')
    return
  }

  await announcementRead.createMany({
    data: validIds.map((announcementId) => ({
      announcementId,
      userId,
      readAt: nowDate
    })),
    skipDuplicates: true
  })

  response.success(
    ctx,
    {
      markedCount: validIds.length
    },
    '批量标记已读成功'
  )
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
    response.error(ctx, HTTP_STATUS.BAD_REQUEST, 'type 不合法')
    return
  }
  if (
    status !== undefined &&
    status !== null &&
    status !== '' &&
    !isAnnouncementStatus(status)
  ) {
    response.error(ctx, HTTP_STATUS.BAD_REQUEST, 'status 不合法')
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
    response.error(
      ctx,
      HTTP_STATUS.BAD_REQUEST,
      e instanceof Error ? e.message : '参数异常'
    )
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
        deletedAt: true,
        ...announcementVersionSelect
      },
      orderBy: [{ status: 'asc' }, { priority: 'desc' }, { createdAt: 'desc' }],
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
    response.error(ctx, HTTP_STATUS.BAD_REQUEST, '参数异常')
    return
  }

  const data = await announcement.findFirst({
    where: {
      id: Number(id),
      deletedAt: null
    }
  })

  if (!data) {
    response.error(ctx, HTTP_STATUS.NOT_FOUND, '公告不存在')
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
    actionUrl,
    minClientVersion,
    maxClientVersion
  } = (ctx.request.body ?? {}) as Record<string, unknown>

  if ([id, title, summary, content, publishAt].some((value) => !value)) {
    response.error(ctx, HTTP_STATUS.BAD_REQUEST, '参数异常')
    return
  }
  const idNum = Number(id)
  if (Number.isNaN(idNum)) {
    response.error(ctx, HTTP_STATUS.BAD_REQUEST, 'id 格式异常')
    return
  }

  const data: Prisma.AnnouncementUpdateInput = {}
  const [titleText, summaryText, contentText] = [title, summary, content].map(
    (item) => String(item).trim()
  )
  if ([titleText, summaryText, contentText].some(isEmpty)) {
    response.error(ctx, HTTP_STATUS.BAD_REQUEST, '参数异常')
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
    response.error(
      ctx,
      HTTP_STATUS.BAD_REQUEST,
      e instanceof Error ? e.message : '参数异常'
    )
    return
  }

  let publishAtDate: Date | null = null
  let expireAtDate: Date | null = null
  try {
    publishAtDate = parseToDate(publishAt, 'publishAt')
    expireAtDate = parseToDate(expireAt, 'expireAt')
  } catch (e) {
    response.error(
      ctx,
      HTTP_STATUS.BAD_REQUEST,
      e instanceof Error ? e.message : '参数异常'
    )
    return
  }
  if (!publishAtDate) {
    response.error(ctx, HTTP_STATUS.BAD_REQUEST, 'publishAt 不可为空')
    return
  }
  const timeErr = validateExpireAfterPublish(publishAtDate, expireAtDate)
  if (timeErr) {
    response.error(ctx, HTTP_STATUS.BAD_REQUEST, timeErr)
    return
  }
  data.publishAt = publishAtDate
  data.expireAt = { set: expireAtDate }

  const versionParsed = parseAnnouncementClientVersionRange(
    minClientVersion,
    maxClientVersion
  )
  if (!versionParsed.ok) {
    response.error(ctx, HTTP_STATUS.BAD_REQUEST, versionParsed.error)
    return
  }
  data.minClientVersion = versionParsed.range.minClientVersion
  data.maxClientVersion = versionParsed.range.maxClientVersion

  const exists = await announcement.findFirst({
    where: { id: idNum, deletedAt: null },
    select: { id: true }
  })
  if (!exists) {
    response.error(ctx, HTTP_STATUS.NOT_FOUND, '公告不存在')
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
    expireAt,
    minClientVersion,
    maxClientVersion
  } = ctx.request.body ?? {}

  // type 需要是 Prisma 枚举值，运行时无法完全校验，至少保证必填字段存在
  if ([type, title, summary, content, publishAt].some((value) => !value)) {
    response.error(ctx, HTTP_STATUS.BAD_REQUEST, '参数异常')
    return
  }

  if (!isAnnouncementType(type)) {
    response.error(ctx, HTTP_STATUS.BAD_REQUEST, 'type 不合法')
    return
  }

  const [titleText, summaryText, contentText] = [title, summary, content].map(
    (item) => String(item).trim()
  )
  if ([titleText, summaryText, contentText].some(isEmpty)) {
    response.error(ctx, HTTP_STATUS.BAD_REQUEST, '参数异常')
    return
  }

  const announcementType = type

  let publishAtDate: Date | null = null
  let expireAtDate: Date | null = null
  try {
    publishAtDate = parseToDate(publishAt, 'publishAt')
    expireAtDate = parseToDate(expireAt, 'expireAt')
  } catch (e) {
    response.error(
      ctx,
      HTTP_STATUS.BAD_REQUEST,
      e instanceof Error ? e.message : '参数异常'
    )
    return
  }
  if (!publishAtDate) {
    response.error(ctx, HTTP_STATUS.BAD_REQUEST, 'publishAt 不可为空')
    return
  }

  const createTimeErr = validateExpireAfterPublish(publishAtDate, expireAtDate)
  if (createTimeErr) {
    response.error(ctx, HTTP_STATUS.BAD_REQUEST, createTimeErr)
    return
  }

  // 改为默认未发布状态
  const createStatus: AnnouncementStatus =
    status === 'published' ? 'published' : 'disabled'
  let priorityValue = 0
  try {
    priorityValue = parsePriority(priority)
  } catch (e) {
    response.error(
      ctx,
      HTTP_STATUS.BAD_REQUEST,
      e instanceof Error ? e.message : '参数异常'
    )
    return
  }

  const versionParsed = parseAnnouncementClientVersionRange(
    minClientVersion,
    maxClientVersion
  )
  if (!versionParsed.ok) {
    response.error(ctx, HTTP_STATUS.BAD_REQUEST, versionParsed.error)
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
      expireAt: expireAtDate,
      minClientVersion: versionParsed.range.minClientVersion,
      maxClientVersion: versionParsed.range.maxClientVersion
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
    response.error(ctx, HTTP_STATUS.BAD_REQUEST, '参数异常')
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
    response.error(ctx, HTTP_STATUS.BAD_REQUEST, '参数异常')
    return
  }

  const target = await announcement.findFirst({
    where: { id: Number(id), deletedAt: null },
    select: { id: true, status: true }
  })
  if (!target) {
    response.error(ctx, HTTP_STATUS.NOT_FOUND, '公告不存在')
    return
  }

  if (target.status === 'published') {
    response.error(ctx, HTTP_STATUS.CONFLICT, '已发布公告不可删除')
    return
  }

  const deleted = await announcement.update({
    where: { id: Number(id) },
    data: { deletedAt: new Date() }
  })

  response.success(ctx, deleted, '删除成功')
})
