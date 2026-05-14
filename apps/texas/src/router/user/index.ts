import type { ParameterizedContext } from 'koa'
import type { PrismaUniqueConstraintMeta } from '../interface'

import dayjs from 'dayjs'
import { omit } from 'ramda'
import { v4 as uuidv4 } from 'uuid'
import { Prisma, AssetUsageType } from '@prisma/texas-client'

import { getToken } from '../../utils/login'
import combinePath from '../../utils/combinePath'
import router, { type DefaultState } from '../instance'
import { HTTP_STATUS } from '../../constants/httpStatus'
import response, { withList } from '../../utils/response'
import prisma, { user, userSettings, assetUsageEvent } from '../../models'
import {
  setLoginSession,
  getLoginSession,
  clearLoginSession
} from '../../utils/loginSession'
import {
  timeFormat,
  apiPrefixWeb,
  apiPrefixClient,
  tokenValidatedTime
} from '../../config'
import {
  grantMailAttachments,
  canUsePokerBackgroundKey,
  listOwnedPokerBackgroundKeys
} from '../../services/mailReward'
import {
  isAllowedClientAssetUsage,
  isAllowedProfileAvatarKey,
  isAllowedPokerBackgroundKey,
  isAllowedTableBackgroundKey
} from '../../constants/clientAssetIdValidation'

const userClientApi = combinePath(apiPrefixClient)('/user')
const userWebApi = combinePath(apiPrefixWeb)('/user')
const DEFAULT_PRIVACY_SETTINGS = {
  showHistoryRecords: true,
  showRecordOverview: true,
  autoCallOnOffline: false
}
const RENAME_CARD_CODE = 'rename_card'
const RENAME_CARD_NAME = '改名卡'
const RENAME_CARD_DEFAULT_QUANTITY = 5
const MAIL_DEFAULT_PAGE_SIZE = 20
const MAIL_MAX_PAGE_SIZE = 100
const FORBIDDEN_NICKNAMES = new Set([
  '你',
  '我',
  '他',
  '谁',
  '爸',
  '妈',
  '爸爸',
  '妈妈'
])

type ItemCatalogEntry = {
  code: string
  name: string
  description: string | null
  stackable: boolean
  config: Prisma.JsonValue | null
  quantity: number
}

type MailAttachmentDTO = {
  id: number
  itemCode: string
  quantity: number
  assetType: string | null
  assetKey: string | null
}

type UserMailListEntryDTO = {
  id: number
  title: string
  summary: string
  body: string
  status: 'unclaimed' | 'claimed'
  createdAt: string
  expireAt: string
  claimedAt: string | null
  attachments: MailAttachmentDTO[]
}

function normalizeNickname(name: unknown): string {
  return typeof name === 'string' ? name.trim() : ''
}

function isForbiddenNickname(name: string): boolean {
  return FORBIDDEN_NICKNAMES.has(name)
}

function toMailEntryDTO(row: {
  id: number
  title: string
  summary: string
  body: string
  status: 'unclaimed' | 'claimed'
  createdAt: Date
  expireAt: Date
  claimedAt: Date | null
  attachments: Array<{
    id: number
    itemCode: string
    quantity: number
    assetType: string | null
    assetKey: string | null
  }>
}): UserMailListEntryDTO {
  return {
    id: row.id,
    title: row.title,
    summary: row.summary,
    body: row.body,
    status: row.status,
    createdAt: dayjs(row.createdAt).format(timeFormat),
    expireAt: dayjs(row.expireAt).format(timeFormat),
    claimedAt: row.claimedAt ? dayjs(row.claimedAt).format(timeFormat) : null,
    attachments: row.attachments.map((a) => ({
      id: a.id,
      itemCode: a.itemCode,
      quantity: a.quantity,
      assetType: a.assetType,
      assetKey: a.assetKey
    }))
  }
}

async function ensureRenameCardDefinition(db: {
  itemDefinition: Prisma.TransactionClient['itemDefinition']
}): Promise<{ id: number }> {
  return db.itemDefinition.upsert({
    where: { code: RENAME_CARD_CODE },
    create: {
      code: RENAME_CARD_CODE,
      name: RENAME_CARD_NAME,
      description: null,
      kind: 'consumable',
      stackable: true,
      config: { kind: 'rename_card' },
      sortOrder: 100,
      isActive: true
    },
    update: {
      kind: 'consumable',
      isActive: true
    },
    select: { id: true }
  })
}

async function grantDefaultRenameCards(
  tx: Prisma.TransactionClient,
  userId: number
) {
  const item = await ensureRenameCardDefinition(tx)
  await tx.userItemBalance.upsert({
    where: {
      userId_itemId: {
        userId,
        itemId: item.id
      }
    },
    create: {
      userId,
      itemId: item.id,
      quantity: RENAME_CARD_DEFAULT_QUANTITY
    },
    update: {}
  })
}

/**
 * 用户登录 / 注册（客户端 sign 与 Web login 共用逻辑）
 */
async function handleSignOrRegister(ctx: ParameterizedContext<DefaultState>) {
  const {
    username,
    password
  }: {
    username: Prisma.UserCreateInput['username']
    password: Prisma.UserCreateInput['password']
  } = ctx.request.body
  if (!username || !password) {
    response.error(ctx, HTTP_STATUS.BAD_REQUEST, '参数异常')
    return
  }
  const sessionId = uuidv4()

  const target = await user.findFirst({ where: { username } })

  // 存在账户, 直接登录
  if (target) {
    if (target.password === password) {
      setLoginSession(target.id!, sessionId, 'client')
      response.success(
        ctx,
        {
          token: getToken({
            sessionId,
            id: target.id
          }),
          type: 'login',
          hasSetName: target.hasSetName
        },
        '登录成功'
      )
    } else {
      // 密码错误
      response.error(ctx, HTTP_STATUS.BAD_REQUEST, '密码错误', {
        type: 'INVALID_CREDENTIALS'
      })
    }
  } else {
    const ramdomName = `用户_${sessionId.slice(0, 6)}_${dayjs().format(
      'yyyy-MM-DD'
    )}`
    // 注册
    try {
      const target = await prisma.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: {
            name: ramdomName,
            username,
            password,
            balance: 0,
            settings: {
              create: {}
            }
            // avatarKey 使用 schema 默认 cartoon/default；avatarUrl 可选
          }
        })
        await grantDefaultRenameCards(tx, created.id)
        return created
      })
      setLoginSession(target.id!, sessionId, 'client')
      response.success(
        ctx,
        {
          token: getToken({
            sessionId,
            id: target.id!
          }),
          type: 'register',
          hasSetName: target.hasSetName
        },
        '注册成功'
      )
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const metaTarget = error.meta?.target as PrismaUniqueConstraintMeta
        const targets: string[] = []
        if (Array.isArray(metaTarget)) {
          targets.push(...metaTarget)
        } else if (typeof metaTarget === 'string') {
          targets.push(metaTarget)
        }

        if (targets.includes('name')) {
          response.error(ctx, HTTP_STATUS.CONFLICT, '用户昵称已存在')
        } else if (targets.includes('username')) {
          response.error(ctx, HTTP_STATUS.CONFLICT, '用户名已存在')
        } else {
          response.error(ctx, HTTP_STATUS.CONFLICT, '用户信息已存在')
        }
      } else {
        throw error
      }
    }
  }
}

/**
 * 用户登录接口
 * 目前测试只用输入昵称即可
 * 正式版本需要调用weChat实现登录注册
 */
router.post(userClientApi('/sign'), handleSignOrRegister)

/** Web 端登录（仅登录，不自动注册） */
router.post(userWebApi('/login'), async (ctx) => {
  const {
    username,
    password
  }: {
    username: Prisma.UserCreateInput['username']
    password: Prisma.UserCreateInput['password']
  } = ctx.request.body
  if (!username || !password) {
    response.error(ctx, HTTP_STATUS.BAD_REQUEST, '参数异常')
    return
  }

  const target = await user.findFirst({ where: { username } })
  /** 与密码错误同码同文案，避免暴露「用户名是否存在」；勿用 404（Web 端会把 404 当成整页资源缺失跳转） */
  if (!target) {
    response.error(ctx, HTTP_STATUS.BAD_REQUEST, '用户名或密码错误', {
      type: 'INVALID_LOGIN'
    })
    return
  }

  if (target.password !== password) {
    response.error(ctx, HTTP_STATUS.BAD_REQUEST, '用户名或密码错误', {
      type: 'INVALID_LOGIN'
    })
    return
  }

  const sessionId = uuidv4()
  const token = getToken({
    sessionId,
    id: target.id
  })
  setLoginSession(target.id!, sessionId, 'web')
  ctx.cookies.set('token', token, {
    maxAge: tokenValidatedTime * 1000,
    httpOnly: true
  })
  response.success(
    ctx,
    {
      token,
      type: 'login'
    },
    '登录成功'
  )
})

async function handleLogout(
  ctx: ParameterizedContext<DefaultState>,
  scope: 'web' | 'client'
) {
  const userId = ctx.state.user?.id
  if (userId) {
    await clearLoginSession(userId, scope)
  }

  if (scope === 'web') {
    ctx.cookies.set('token', null, {
      maxAge: 0,
      httpOnly: true
    })
  }
  response.success(ctx, null, '退出成功')
}

/** Web 端退出登录 */
router.post(userWebApi('/logout'), async (ctx) => {
  await handleLogout(ctx, 'web')
})

/** Client 端退出登录 */
router.post(userClientApi('/logout'), async (ctx) => {
  await handleLogout(ctx, 'client')
})

// 此接口会被middleware接管, 必定有用户信息
router.post(userClientApi('/setName'), async (ctx) => {
  const normalizedName = normalizeNickname(
    (ctx.request.body as { name?: unknown } | undefined)?.name
  )
  if (!normalizedName) {
    response.error(ctx, HTTP_STATUS.BAD_REQUEST, '名称不可为空')
    return
  }
  if (isForbiddenNickname(normalizedName)) {
    response.error(ctx, HTTP_STATUS.BAD_REQUEST, '昵称不合规')
    return
  }

  const userId = ctx.state.user!.id

  try {
    const updatedUser = await user.update({
      where: { id: userId },
      data: {
        name: normalizedName,
        hasSetName: true
      }
    })
    response.success(ctx, omit(['password'], updatedUser), '昵称设置成功')
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        response.error(ctx, HTTP_STATUS.CONFLICT, '用户昵称已存在')
        return
      }

      if (error.code === 'P2025') {
        response.error(ctx, HTTP_STATUS.NOT_FOUND, '用户不存在')
        return
      }
    }

    throw error
  }
})

/** 读取当前用户持有道具（仅返回数量 > 0，用于「藏品-道具」tab） */
router.post(userClientApi('/items'), async (ctx) => {
  const userId = ctx.state.user?.id
  if (!userId) {
    response.error(ctx, HTTP_STATUS.UNAUTHORIZED, '身份凭证无效, 请重新登录')
    return
  }
  // 兜底确保目录中存在改名卡（避免迁移遗漏导致空列表）
  await ensureRenameCardDefinition(prisma)
  const balances = await prisma.userItemBalance.findMany({
    where: {
      userId,
      quantity: { gt: 0 },
      item: { isActive: true, kind: 'consumable' }
    },
    orderBy: [{ item: { sortOrder: 'asc' } }, { itemId: 'asc' }],
    select: {
      quantity: true,
      item: {
        select: {
          code: true,
          name: true,
          description: true,
          stackable: true,
          config: true
        }
      }
    }
  })
  if (balances.length === 0) {
    response.success(ctx, [] as ItemCatalogEntry[])
    return
  }
  const list: ItemCatalogEntry[] = balances.map((row) => ({
    code: row.item.code,
    name: row.item.name,
    description: row.item.description,
    stackable: row.item.stackable,
    config: row.item.config,
    quantity: row.quantity
  }))
  response.success(ctx, list)
})

/** 使用改名卡并改昵称（不记录曾用名，仅直接更新 User.name） */
router.post(userClientApi('/renameWithCard'), async (ctx) => {
  const userId = ctx.state.user?.id
  if (!userId) {
    response.error(ctx, HTTP_STATUS.UNAUTHORIZED, '身份凭证无效, 请重新登录')
    return
  }
  const normalizedName = normalizeNickname(
    (ctx.request.body as { name?: unknown } | undefined)?.name
  )
  if (!normalizedName) {
    response.error(ctx, HTTP_STATUS.BAD_REQUEST, '名称不可为空')
    return
  }
  if (isForbiddenNickname(normalizedName)) {
    response.error(ctx, HTTP_STATUS.BAD_REQUEST, '昵称不合规')
    return
  }

  const current = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      avatarUrl: true,
      avatarKey: true,
      pokerBackgroundKey: true,
      tableBackgroundKey: true,
      username: true,
      createdAt: true
    }
  })
  if (!current) {
    response.error(ctx, HTTP_STATUS.NOT_FOUND, '用户不存在')
    return
  }
  if (current.name === normalizedName) {
    response.error(ctx, HTTP_STATUS.BAD_REQUEST, '与现有昵称一致')
    return
  }

  const renameRefId = uuidv4()
  try {
    const result = await prisma.$transaction(async (tx) => {
      const item = await ensureRenameCardDefinition(tx)
      const consumeResult = await tx.userItemBalance.updateMany({
        where: {
          userId,
          itemId: item.id,
          quantity: { gte: 1 }
        },
        data: {
          quantity: { decrement: 1 }
        }
      })
      if (consumeResult.count === 0) {
        throw new Error('RENAME_CARD_INSUFFICIENT')
      }
      const balance = await tx.userItemBalance.findUnique({
        where: {
          userId_itemId: {
            userId,
            itemId: item.id
          }
        },
        select: { quantity: true }
      })
      const updatedUser = await tx.user.update({
        where: { id: userId },
        data: {
          name: normalizedName,
          hasSetName: true
        },
        select: {
          id: true,
          name: true,
          avatarUrl: true,
          avatarKey: true,
          pokerBackgroundKey: true,
          tableBackgroundKey: true,
          username: true,
          createdAt: true
        }
      })
      await tx.userItemLedger.create({
        data: {
          userId,
          itemId: item.id,
          delta: -1,
          balanceAfter: balance?.quantity ?? 0,
          reason: 'rename_consume',
          refType: 'rename_nickname',
          refId: renameRefId
        }
      })
      return {
        user: {
          ...updatedUser,
          createdAt: dayjs(updatedUser.createdAt).format(timeFormat)
        },
        remainingRenameCards: balance?.quantity ?? 0
      }
    })
    response.success(ctx, result, '改名成功')
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === 'RENAME_CARD_INSUFFICIENT'
    ) {
      response.error(ctx, HTTP_STATUS.BAD_REQUEST, '改名卡不足')
      return
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        response.error(ctx, HTTP_STATUS.CONFLICT, '用户昵称已存在')
        return
      }
      if (error.code === 'P2025') {
        response.error(ctx, HTTP_STATUS.NOT_FOUND, '用户不存在')
        return
      }
    }
    throw error
  }
})

async function fetchUserInfo(ctx: ParameterizedContext<DefaultState>) {
  const parsedUser = ctx.state.user
  const userId = parsedUser?.id

  if (!userId) {
    response.success(ctx, null)
    return
  }

  const scope = ctx.path.startsWith('/api/web/') ? 'web' : 'client'
  const latestSession = await getLoginSession(userId, scope)
  if (!latestSession || latestSession.sessionId !== parsedUser.sessionId) {
    // info 接口用于静默探测登录态：会话无效时返回 null，不返回 401
    response.success(ctx, null)
    return
  }

  const userInfo = await user.findUnique({
    where: {
      id: userId
    },
    select: {
      id: true,
      name: true,
      avatarUrl: true,
      avatarKey: true,
      pokerBackgroundKey: true,
      tableBackgroundKey: true,
      username: true,
      createdAt: true,
      isAdmin: true
    }
  })
  if (!userInfo) {
    response.error(ctx, HTTP_STATUS.NOT_FOUND, '用户不存在')
  } else {
    const { createdAt, ...rest } = userInfo
    const ownedPokerBackgroundKeys = await listOwnedPokerBackgroundKeys(
      prisma,
      userId
    )
    response.success(ctx, {
      createdAt: dayjs(createdAt).format(timeFormat),
      ...rest,
      ownedPokerBackgroundKeys
    })
  }
}

router.post(userClientApi('/info'), async (ctx) => {
  await fetchUserInfo(ctx)
})

/** Web 端获取用户信息，需 Cookie `token` 或 Authorization Bearer（与客户端一致） */
router.post(userWebApi('/info'), async (ctx) => {
  await fetchUserInfo(ctx)
})

/** 查询任意用户公开资料（登录态下可访问，用于他人视角资料页）。 */
router.post(userClientApi('/profile'), async (ctx) => {
  const viewerId = ctx.state.user?.id
  const { userId }: { userId?: number } = ctx.request.body ?? {}
  if (!viewerId) {
    response.error(ctx, HTTP_STATUS.UNAUTHORIZED, '身份凭证无效, 请重新登录')
    return
  }
  if (!userId || Number.isNaN(Number(userId)) || Number(userId) <= 0) {
    response.error(ctx, HTTP_STATUS.BAD_REQUEST, '参数异常：需要 userId')
    return
  }
  const profile = await user.findUnique({
    where: { id: Number(userId) },
    select: {
      id: true,
      name: true,
      avatarUrl: true,
      avatarKey: true,
      pokerBackgroundKey: true,
      tableBackgroundKey: true,
      username: true,
      createdAt: true
    }
  })
  if (!profile) {
    response.error(ctx, HTTP_STATUS.NOT_FOUND, '用户不存在')
    return
  }
  const ownedPokerBackgroundKeys = await listOwnedPokerBackgroundKeys(
    prisma,
    Number(userId)
  )
  response.success(ctx, {
    ...profile,
    createdAt: dayjs(profile.createdAt).format(timeFormat),
    ownedPokerBackgroundKeys
  })
})

/**
 * 卡面（牌背）预设 key，body: { pokerBackgroundKey: string }
 */
router.post(userClientApi('/setPokerBackground'), async (ctx) => {
  const userId = ctx.state.user!.id
  const { pokerBackgroundKey }: { pokerBackgroundKey?: string } =
    ctx.request.body ?? {}

  if (
    pokerBackgroundKey === undefined ||
    typeof pokerBackgroundKey !== 'string' ||
    pokerBackgroundKey.trim().length === 0
  ) {
    response.error(
      ctx,
      HTTP_STATUS.BAD_REQUEST,
      '请传入有效的 pokerBackgroundKey'
    )
    return
  }
  const key = pokerBackgroundKey.trim()
  if (key.length > 128) {
    response.error(ctx, HTTP_STATUS.BAD_REQUEST, 'pokerBackgroundKey 过长')
    return
  }
  if (!isAllowedPokerBackgroundKey(key)) {
    response.error(
      ctx,
      HTTP_STATUS.BAD_REQUEST,
      'pokerBackgroundKey 不在允许列表'
    )
    return
  }
  const canUse = await canUsePokerBackgroundKey(prisma, userId, key)
  if (!canUse) {
    response.error(ctx, HTTP_STATUS.FORBIDDEN, '该卡面尚未解锁')
    return
  }

  try {
    await user.update({
      where: { id: userId },
      data: { pokerBackgroundKey: key }
    })
    response.success(ctx, null, '卡面更新成功')
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2025'
    ) {
      response.error(ctx, HTTP_STATUS.NOT_FOUND, '用户不存在')
      return
    }
    throw error
  }
})

/**
 * 牌桌台布预设 key，body: { tableBackgroundKey: string }
 */
router.post(userClientApi('/setTableBackground'), async (ctx) => {
  const userId = ctx.state.user!.id
  const { tableBackgroundKey }: { tableBackgroundKey?: string } =
    ctx.request.body ?? {}

  if (
    tableBackgroundKey === undefined ||
    typeof tableBackgroundKey !== 'string' ||
    tableBackgroundKey.trim().length === 0
  ) {
    response.error(
      ctx,
      HTTP_STATUS.BAD_REQUEST,
      '请传入有效的 tableBackgroundKey'
    )
    return
  }
  const key = tableBackgroundKey.trim()
  if (key.length > 128) {
    response.error(ctx, HTTP_STATUS.BAD_REQUEST, 'tableBackgroundKey 过长')
    return
  }
  if (!isAllowedTableBackgroundKey(key)) {
    response.error(
      ctx,
      HTTP_STATUS.BAD_REQUEST,
      'tableBackgroundKey 不在允许列表'
    )
    return
  }

  try {
    await user.update({
      where: { id: userId },
      data: { tableBackgroundKey: key }
    })
    response.success(ctx, null, '牌桌背景更新成功')
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2025'
    ) {
      response.error(ctx, HTTP_STATUS.NOT_FOUND, '用户不存在')
      return
    }
    throw error
  }
})

/**
 * 修改预设头像，body: { avatarKey: string }（如 cartoon/default）
 * 会清空 avatarUrl，客户端按 avatarKey 映射本地资源展示
 */
router.post(userClientApi('/setAvatar'), async (ctx) => {
  const userId = ctx.state.user!.id
  const { avatarKey }: { avatarKey?: string } = ctx.request.body ?? {}

  if (
    avatarKey === undefined ||
    typeof avatarKey !== 'string' ||
    avatarKey.trim().length === 0
  ) {
    response.error(ctx, HTTP_STATUS.BAD_REQUEST, '请传入有效的 avatarKey')
    return
  }
  const avatarKeyNorm = avatarKey.trim()
  if (!isAllowedProfileAvatarKey(avatarKeyNorm)) {
    response.error(ctx, HTTP_STATUS.BAD_REQUEST, 'avatarKey 不在允许列表')
    return
  }

  try {
    await user.update({
      where: { id: userId },
      data: {
        avatarKey: avatarKeyNorm,
        avatarUrl: null
      }
    })
    response.success(ctx, null, '头像更新成功')
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2025'
    ) {
      response.error(ctx, HTTP_STATUS.NOT_FOUND, '用户不存在')
      return
    }
    throw error
  }
})

/** 邮件列表（仅返回未过期、未删除邮件） */
router.post(userClientApi('/mail/list'), async (ctx) => {
  const userId = ctx.state.user!.id
  const {
    current = 1,
    pageSize = MAIL_DEFAULT_PAGE_SIZE
  }: { current?: number; pageSize?: number } = ctx.request.body ?? {}
  const currentNorm = Math.max(1, Math.floor(Number(current) || 1))
  const pageSizeNorm = Math.max(
    1,
    Math.min(
      MAIL_MAX_PAGE_SIZE,
      Math.floor(Number(pageSize) || MAIL_DEFAULT_PAGE_SIZE)
    )
  )
  const now = new Date()
  const where = {
    userId,
    deletedAt: null,
    expireAt: { gt: now }
  } as const
  const [total, rows] = await Promise.all([
    prisma.userMail.count({ where }),
    prisma.userMail.findMany({
      where,
      include: {
        attachments: {
          select: {
            id: true,
            itemCode: true,
            quantity: true,
            assetType: true,
            assetKey: true
          }
        }
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (currentNorm - 1) * pageSizeNorm,
      take: pageSizeNorm
    })
  ])
  response.success(
    ctx,
    withList(
      rows.map((row) => toMailEntryDTO(row)),
      total
    ),
    '查询成功'
  )
})

/** 邮件详情（仅返回未过期、未删除邮件） */
router.post(userClientApi('/mail/detail'), async (ctx) => {
  const userId = ctx.state.user!.id
  const { mailId }: { mailId?: number } = ctx.request.body ?? {}
  if (!mailId || Number(mailId) <= 0) {
    response.error(ctx, HTTP_STATUS.BAD_REQUEST, '参数异常：需要 mailId')
    return
  }
  const row = await prisma.userMail.findFirst({
    where: {
      id: Number(mailId),
      userId,
      deletedAt: null,
      expireAt: { gt: new Date() }
    },
    include: {
      attachments: {
        select: {
          id: true,
          itemCode: true,
          quantity: true,
          assetType: true,
          assetKey: true
        }
      }
    }
  })
  if (!row) {
    response.error(ctx, HTTP_STATUS.NOT_FOUND, '邮件不存在或已过期')
    return
  }
  response.success(ctx, toMailEntryDTO(row), '查询成功')
})

/** 未领取邮件数量（仅统计未过期、未删除） */
router.post(userClientApi('/mail/unclaimedCount'), async (ctx) => {
  const userId = ctx.state.user!.id
  const count = await prisma.userMail.count({
    where: {
      userId,
      status: 'unclaimed',
      deletedAt: null,
      expireAt: { gt: new Date() }
    }
  })
  response.success(ctx, { count }, '查询成功')
})

/** 领取邮件奖励 */
router.post(userClientApi('/mail/claim'), async (ctx) => {
  const userId = ctx.state.user!.id
  const { mailId }: { mailId?: number } = ctx.request.body ?? {}
  if (!mailId || Number(mailId) <= 0) {
    response.error(ctx, HTTP_STATUS.BAD_REQUEST, '参数异常：需要 mailId')
    return
  }
  const now = new Date()
  try {
    await prisma.$transaction(async (tx) => {
      const mail = await tx.userMail.findUnique({
        where: { id: Number(mailId) },
        select: {
          id: true,
          userId: true,
          status: true,
          deletedAt: true,
          expireAt: true
        }
      })
      if (!mail || mail.userId !== userId || mail.deletedAt != null) {
        throw new Error('MAIL_NOT_FOUND')
      }
      if (mail.expireAt.getTime() <= now.getTime()) {
        throw new Error('MAIL_EXPIRED')
      }
      if (mail.status !== 'unclaimed') {
        throw new Error('MAIL_ALREADY_CLAIMED')
      }
      const claimed = await tx.userMail.updateMany({
        where: {
          id: Number(mailId),
          userId,
          status: 'unclaimed',
          deletedAt: null,
          expireAt: { gt: now }
        },
        data: {
          status: 'claimed',
          claimedAt: now
        }
      })
      if (claimed.count === 0) {
        throw new Error('MAIL_CLAIM_CONFLICT')
      }
      await grantMailAttachments(tx, userId, Number(mailId))
    })
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === 'MAIL_NOT_FOUND') {
        response.error(ctx, HTTP_STATUS.NOT_FOUND, '邮件不存在')
        return
      }
      if (error.message === 'MAIL_EXPIRED') {
        response.error(ctx, HTTP_STATUS.BAD_REQUEST, '邮件已过期')
        return
      }
      if (
        error.message === 'MAIL_ALREADY_CLAIMED' ||
        error.message === 'MAIL_CLAIM_CONFLICT'
      ) {
        response.error(ctx, HTTP_STATUS.BAD_REQUEST, '邮件已领取')
        return
      }
      if (error.message.startsWith('MAIL_ATTACHMENT_ITEM_NOT_FOUND:')) {
        response.error(ctx, HTTP_STATUS.CONFLICT, '邮件附件配置异常')
        return
      }
    }
    throw error
  }
  response.success(ctx, null, '领取成功')
})

/** 删除已领取邮件（软删除） */
router.post(userClientApi('/mail/delete'), async (ctx) => {
  const userId = ctx.state.user!.id
  const { mailId }: { mailId?: number } = ctx.request.body ?? {}
  if (!mailId || Number(mailId) <= 0) {
    response.error(ctx, HTTP_STATUS.BAD_REQUEST, '参数异常：需要 mailId')
    return
  }
  const deleted = await prisma.userMail.updateMany({
    where: {
      id: Number(mailId),
      userId,
      status: 'claimed',
      deletedAt: null
    },
    data: { deletedAt: new Date() }
  })
  if (deleted.count === 0) {
    response.error(ctx, HTTP_STATUS.BAD_REQUEST, '仅已领取邮件可删除')
    return
  }
  response.success(ctx, null, '删除成功')
})

// 查询用户设置
router.post(userClientApi('/settings'), async (ctx) => {
  const userId = ctx.state.user!.id
  const settings = await userSettings.findUnique({
    where: { userId },
    select: {
      showHistoryRecords: true,
      showRecordOverview: true,
      autoCallOnOffline: true
    }
  })

  if (!settings) {
    response.success(ctx, DEFAULT_PRIVACY_SETTINGS, '查询成功')
    return
  }

  response.success(ctx, settings, '查询成功')
})

/** 查询指定用户隐私开关（用于他人视角 profile）；仅返回可见性字段。 */
router.post(userClientApi('/privacy'), async (ctx) => {
  const viewerId = ctx.state.user?.id
  const { userId }: { userId?: number } = ctx.request.body ?? {}
  if (!viewerId) {
    response.error(ctx, HTTP_STATUS.UNAUTHORIZED, '身份凭证无效, 请重新登录')
    return
  }
  if (!userId || Number.isNaN(Number(userId)) || Number(userId) <= 0) {
    response.error(ctx, HTTP_STATUS.BAD_REQUEST, '参数异常：需要 userId')
    return
  }

  const exists = await user.findUnique({
    where: { id: Number(userId) },
    select: { id: true }
  })
  if (!exists) {
    response.error(ctx, HTTP_STATUS.NOT_FOUND, '用户不存在')
    return
  }

  const settings = await userSettings.findUnique({
    where: { userId: Number(userId) },
    select: {
      showHistoryRecords: true,
      showRecordOverview: true
    }
  })
  response.success(
    ctx,
    settings ?? {
      showHistoryRecords: DEFAULT_PRIVACY_SETTINGS.showHistoryRecords,
      showRecordOverview: DEFAULT_PRIVACY_SETTINGS.showRecordOverview
    },
    '查询成功'
  )
})

// 修改用户设置
router.post(userClientApi('/setSettings'), async (ctx) => {
  const userId = ctx.state.user!.id
  const {
    showHistoryRecords,
    showRecordOverview,
    autoCallOnOffline
  }: {
    showHistoryRecords?: boolean
    showRecordOverview?: boolean
    autoCallOnOffline?: boolean
  } = ctx.request.body ?? {}

  const data: {
    showHistoryRecords?: boolean
    showRecordOverview?: boolean
    autoCallOnOffline?: boolean
  } = {}
  if (typeof showHistoryRecords === 'boolean') {
    data.showHistoryRecords = showHistoryRecords
  }
  if (typeof showRecordOverview === 'boolean') {
    data.showRecordOverview = showRecordOverview
  }
  if (typeof autoCallOnOffline === 'boolean') {
    data.autoCallOnOffline = autoCallOnOffline
  }

  if (Object.keys(data).length === 0) {
    response.error(ctx, HTTP_STATUS.BAD_REQUEST, '请至少传入一个设置项')
    return
  }

  const updatedSettings = await userSettings.upsert({
    where: { userId },
    create: {
      user: {
        connect: { id: userId }
      },
      ...data
    },
    update: data,
    select: {
      showHistoryRecords: true,
      showRecordOverview: true,
      autoCallOnOffline: true
    }
  })

  response.success(ctx, updatedSettings, '设置更新成功')
})

/**
 * 客户端资源使用打点（卡背 / 牌桌）。须登录；与藏品/改卡面能力一致。
 * body: { assetType: 'poker_back' | 'table_bg', assetId: string, platform?: string }
 */
router.post(userClientApi('/asset-usage'), async (ctx) => {
  const userId = ctx.state.user?.id
  if (!userId) {
    response.error(ctx, HTTP_STATUS.UNAUTHORIZED, '身份凭证无效, 请重新登录')
    return
  }

  const body = (ctx.request.body ?? {}) as {
    assetType?: string
    assetId?: string
    platform?: string
  }
  const { assetType, assetId, platform } = body
  if (assetType !== 'poker_back' && assetType !== 'table_bg') {
    response.error(ctx, HTTP_STATUS.BAD_REQUEST, 'assetType 无效')
    return
  }
  if (typeof assetId !== 'string' || !assetId.trim()) {
    response.error(ctx, HTTP_STATUS.BAD_REQUEST, 'assetId 无效')
    return
  }
  if (!isAllowedClientAssetUsage(assetType, assetId)) {
    response.error(ctx, HTTP_STATUS.BAD_REQUEST, 'assetId 不在允许列表')
    return
  }
  const platformNorm =
    typeof platform === 'string' && platform.trim().length > 0
      ? platform.trim().slice(0, 16)
      : null

  const enumType: AssetUsageType =
    assetType === 'poker_back'
      ? AssetUsageType.poker_back
      : AssetUsageType.table_bg

  await assetUsageEvent.create({
    data: {
      userId,
      assetType: enumType,
      assetId: assetId.trim(),
      platform: platformNorm
    }
  })

  response.success(ctx, null)
})
