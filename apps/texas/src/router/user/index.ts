import type { ParameterizedContext } from 'koa'
import type { PrismaUniqueConstraintMeta } from '../interface'

import dayjs from 'dayjs'
import { omit } from 'ramda'
import { v4 as uuidv4 } from 'uuid'
import { Prisma } from '@prisma/texas-client'

import response from '../../utils/response'
import { getToken } from '../../utils/login'
import { user, userSettings } from '../../models'
import combinePath from '../../utils/combinePath'
import router, { type DefaultState } from '../instance'
import { ERROR_CODE } from '../../constants/errorCodes'
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

const userClientApi = combinePath(apiPrefixClient)('/user')
const userWebApi = combinePath(apiPrefixWeb)('/user')

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
    response.error(ctx, ERROR_CODE.BAD_REQUEST, '参数异常')
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
          type: 'login'
        },
        '登录成功'
      )
    } else {
      // 密码错误
      response.error(ctx, ERROR_CODE.BUSINESS_VALIDATION, '密码错误')
    }
  } else {
    const ramdomName = `用户_${sessionId.slice(0, 6)}_${dayjs().format(
      'yyyy-MM-DD'
    )}`
    // 注册
    try {
      const target = await user.create({
        data: {
          name: ramdomName,
          username,
          password,
          balance: 20_000,
          settings: {
            create: {}
          }
          // avatarKey 使用 schema 默认 cartoon/default；avatarUrl 可选
        }
      })
      setLoginSession(target.id!, sessionId, 'client')
      response.success(
        ctx,
        {
          token: getToken({
            sessionId,
            id: target.id!
          }),
          type: 'register'
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
          response.error(ctx, ERROR_CODE.USER_NAME_EXISTS, '用户昵称已存在')
        } else if (targets.includes('username')) {
          response.error(ctx, ERROR_CODE.USER_USERNAME_EXISTS, '用户名已存在')
        } else {
          response.error(ctx, ERROR_CODE.USER_INFO_EXISTS, '用户信息已存在')
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
    response.error(ctx, ERROR_CODE.BAD_REQUEST, '参数异常')
    return
  }

  const target = await user.findFirst({ where: { username } })
  if (!target) {
    response.error(ctx, ERROR_CODE.COMMON_FAIL, '用户不存在')
    return
  }

  if (target.password !== password) {
    response.error(ctx, ERROR_CODE.BUSINESS_VALIDATION, '密码错误')
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

/** Web 端退出登录 */
router.post(userWebApi('/logout'), async (ctx) => {
  const userId = ctx.state.user?.id
  if (userId) {
    await clearLoginSession(userId, 'web')
  }
  ctx.cookies.set('token', null, {
    maxAge: 0,
    httpOnly: true
  })
  response.success(ctx, null, '退出成功')
})

/** Client 端退出登录 */
router.post(userClientApi('/logout'), async (ctx) => {
  const userId = ctx.state.user?.id
  if (userId) {
    await clearLoginSession(userId, 'client')
  }
  response.success(ctx, null, '退出成功')
})

// 此接口会被middleware接管, 必定有用户信息
router.post(userClientApi('/setName'), async (ctx) => {
  const { name }: { name: Prisma.UserCreateInput['name'] } = ctx.request.body
  if (!name) {
    response.error(ctx, ERROR_CODE.BAD_REQUEST, '名称不可为空')
    return
  }

  const userId = ctx.state.user!.id

  try {
    const updatedUser = await user.update({
      where: { id: userId },
      data: { name }
    })
    response.success(ctx, omit(['password'], updatedUser), '昵称设置成功')
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        response.error(ctx, ERROR_CODE.USER_NAME_EXISTS, '用户昵称已存在')
        return
      }

      if (error.code === 'P2025') {
        response.error(ctx, ERROR_CODE.COMMON_FAIL, '用户不存在')
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
      username: true,
      createdAt: true,
      isAdmin: true
    }
  })
  if (!userInfo) {
    response.error(ctx, ERROR_CODE.COMMON_FAIL, '用户不存在')
  } else {
    const { createdAt, ...rest } = userInfo
    response.success(ctx, {
      createdAt: dayjs(createdAt).format(timeFormat),
      ...rest
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
    response.error(ctx, ERROR_CODE.BAD_REQUEST, '请传入有效的 avatarKey')
    return
  }

  try {
    await user.update({
      where: { id: userId },
      data: {
        avatarKey: avatarKey.trim(),
        avatarUrl: null
      }
    })
    response.success(ctx, null, '头像更新成功')
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2025'
    ) {
      response.error(ctx, ERROR_CODE.COMMON_FAIL, '用户不存在')
      return
    }
    throw error
  }
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
    response.success(
      ctx,
      {
        showHistoryRecords: true,
        showRecordOverview: true,
        autoCallOnOffline: false
      },
      '查询成功'
    )
    return
  }

  response.success(ctx, settings, '查询成功')
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
    response.error(ctx, ERROR_CODE.BAD_REQUEST, '请至少传入一个设置项')
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
