import type { PrismaUniqueConstraintMeta } from '../interface'

import dayjs from 'dayjs'
import { omit } from 'ramda'
import { v4 as uuidv4 } from 'uuid'
import { Prisma } from '@prisma/texas-client'

import router from '../instance'
import { user } from '../../models'
import response from '../../utils/response'
import { getToken } from '../../utils/login'
import combinePath from '../../utils/combinePath'
import { timeFormat, apiPrefixClient } from '../../config'

const userClientApi = combinePath(apiPrefixClient)('/user')
export const loginUsers = new Map<number, { sessionId: string; time: string }>()

/**
 * 用户登录接口
 * 目前测试只用输入昵称即可
 * 正式版本需要调用weChat实现登录注册
 */
router.post(userClientApi('/sign'), async (ctx) => {
  const {
    username,
    password
  }: {
    username: Prisma.UserCreateInput['username']
    password: Prisma.UserCreateInput['password']
  } = ctx.request.body
  if (!username || !password) {
    response.error(ctx, 400, '参数异常')
    return
  }
  const sessionId = uuidv4()
  const time = dayjs().format(timeFormat)

  const target = await user.findFirst({ where: { username } })

  // 存在账户, 直接登录
  if (target) {
    if (target.password === password) {
      loginUsers.set(target.id!, { sessionId, time })
      response.success(
        ctx,
        { token: getToken({ sessionId, id: target.id }), type: 'login' },
        '登录成功'
      )
    } else {
      // 密码错误
      response.error(ctx, 2100, '密码错误')
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
          balance: 20_000
          // avatarKey 使用 schema 默认 cartoon/default；avatarUrl 可选
        }
      })
      loginUsers.set(target.id!, { sessionId, time })
      response.success(
        ctx,
        { token: getToken({ sessionId, id: target.id }), type: 'register' },
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
          response.error(ctx, 2100, '用户昵称已存在')
        } else if (targets.includes('username')) {
          response.error(ctx, 2101, '用户名已存在')
        } else {
          response.error(ctx, 2102, '用户信息已存在')
        }
      } else {
        throw error
      }
    }
  }
})

// 此接口会被middleware接管, 必定有用户信息
router.post(userClientApi('/setName'), async (ctx) => {
  const { name }: { name: Prisma.UserCreateInput['name'] } = ctx.request.body
  if (!name) {
    response.error(ctx, 400, '名称不可为空')
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
        response.error(ctx, 2100, '用户昵称已存在')
        return
      }

      if (error.code === 'P2025') {
        response.error(ctx, 2000, '用户不存在')
        return
      }
    }

    throw error
  }
})

router.post(userClientApi('/info'), async (ctx) => {
  const userId = ctx.state.user!.id

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
      createdAt: true
    }
  })
  if (!userInfo) {
    response.error(ctx, 2000, '用户不存在')
  } else {
    const { createdAt, ...rest } = userInfo
    response.success(ctx, {
      createdAt: dayjs(createdAt).format(timeFormat),
      ...rest
    })
  }
})

/**
 * 修改头像：自定义 URL 与预设 key 至少传一项
 * body: { avatarUrl?: string | null, avatarKey?: string }
 * - 传 avatarKey：使用客户端预设头像（如 cartoon/default）
 * - 传 avatarUrl：自定义图；传 null 可清空以仅用 avatarKey
 */
router.post(userClientApi('/setAvatar'), async (ctx) => {
  const userId = ctx.state.user!.id
  const {
    avatarUrl,
    avatarKey
  }: {
    avatarUrl?: string | null
    avatarKey?: string
  } = ctx.request.body ?? {}

  const hasUrl = avatarUrl !== undefined
  const hasKey =
    avatarKey !== undefined &&
    typeof avatarKey === 'string' &&
    avatarKey.trim().length > 0

  if (!hasUrl && !hasKey) {
    response.error(ctx, 400, '请传入 avatarUrl 或 avatarKey')
    return
  }

  const data: Prisma.UserUpdateInput = {}
  if (hasUrl) {
    if (avatarUrl === null || avatarUrl === '') {
      data.avatarUrl = null
    } else if (typeof avatarUrl === 'string') {
      data.avatarUrl = avatarUrl.trim()
    } else {
      response.error(ctx, 400, 'avatarUrl 格式异常')
      return
    }
  }
  if (hasKey) {
    data.avatarKey = avatarKey!.trim()
  }

  try {
    await user.update({
      where: { id: userId },
      data
    })
    response.success(ctx, null, '头像更新成功')
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2025'
    ) {
      response.error(ctx, 2000, '用户不存在')
      return
    }
    throw error
  }
})
