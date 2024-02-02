import type { Identity, PrismaError } from '../interface'
import type { UpdateUserReq, GetUserByPaginationReq } from './interface'

import moment from 'moment'
import Cookie from 'cookie'
import { Prisma } from '@prisma/blog-client'
import { map, prop, omit, reduce, compose } from 'ramda'

import router from '../instance'
import { user } from '../../models'
import response from '../../utils/response'
import { withList } from '../../utils/response'
import combinePath from '../../utils/combinePath'
import { apiPrefix, timeFormat } from '../../config'
import { encrypt, decrypt } from '../../utils/cryptor'

const userApi = combinePath(apiPrefix)('/user')

// 登录注册 合并一起
router.post(userApi('/signin'), async (ctx) => {
  const { username, password } = ctx.request.body

  if (!username || !password) throw new Error('参数异常')

  const u = await user.findFirst({
    where: { username }
  })
  // 验证登录
  if (u) {
    const target = await user.findFirst({ where: { username, password } })
    if (!target) {
      response.error(ctx, 403, '用户信息不正确')
      return
    }

    const token = encrypt(`${u.id}`)
    ctx.cookies.set('token', token, {
      httpOnly: true,
      domain: 'wishufree.com',
      expires: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    })
    response.success(ctx, { token }, '登录成功')
    return
  }

  // 注册
  const userInfo = await user.create({
    data: { username, password, name: '用户昵称_' + Math.random() }
  })
  const token = encrypt(`${userInfo.id}`)
  response.success(ctx, { token }, '注册成功')
})

router.post(userApi('/logout'), async (ctx) => {
  ctx.cookies.set('token', null, { domain: 'wishufree.com' })
  response.success(ctx)
})

// 从cookie中查询用户
export async function parseUserInfoByCookie(input?: string) {
  if (!input) return null

  const { token = '' } = Cookie.parse(input)
  const id = decrypt(token)

  if (!id) return null

  const u = await user.findUnique({ where: { id: Number(id) } })
  return u && omit(['password'], u)
}

router.post(userApi('/info'), async (ctx) => {
  const { cookie = '' } = ctx.request.header

  const user = await parseUserInfoByCookie(cookie)
  // if (!user) {
  //   response.error(ctx, 403, '未登录')
  // } else {
  response.success(ctx, user)
  // }
})

router.post(userApi('/add'), async (ctx) => {
  const { name, ...data } = ctx.request.body

  if (!name) throw new Error('昵称不能为空')

  try {
    await user.create({ data: { ...data, name } })
    response.success(ctx)
  } catch (error) {
    const { code } = error as PrismaError

    if (code === 'P2002') throw new Error('账户已存在')
    throw new Error('系统异常')
  }
})

router.post(userApi('/delete'), async (ctx) => {
  const { id }: Identity = ctx.request.body

  if (!id) throw new Error('id 不能为空')

  try {
    await user.delete({ where: { id: Number(id) } })
    response.success(ctx)
  } catch (error) {
    response.success(ctx, null, '用户不存在')
  }
})

router.post(userApi('/update'), async (ctx) => {
  const { id, name, ...data }: UpdateUserReq = ctx.request.body

  if (!id) throw new Error('id 不能为空')
  if (!name) throw new Error('昵称不能为空')

  try {
    await user.update({
      data: { ...data, name },
      where: { id: Number(id) }
    })
    response.success(ctx, null)
  } catch (error) {
    response.success(ctx, null, '用户不存在')
  }
})

router.post(userApi('/list'), async (ctx) => {
  const { name, email, time, current, pageSize }: GetUserByPaginationReq =
    ctx.request.body

  if (!current || !pageSize) throw new Error('分页参数不正确')

  const where: Prisma.UserWhereInput = {}
  if (name) {
    where.name = {
      contains: name
    }
  }
  if (email) {
    where.email = {
      contains: email
    }
  }
  if (time && Array.isArray(time)) {
    const [start, end] = time

    where.createdAt = {
      lte: end,
      gte: start
    }
  }

  const total = await user.count({ where })
  const list = await user.findMany({
    where,
    include: {
      articles: {
        select: {
          viewCount: true
        }
      }
    },
    take: pageSize,
    skip: (current - 1) * pageSize
  })
  const newList = list.map(({ password, createdAt, articles, ...rest }) => ({
    ...rest,
    createdAt: moment(createdAt).format(timeFormat),
    viewCount: articles.reduce((acc, { viewCount }) => acc + viewCount, 0)
  }))
  response.success(ctx, withList(newList, total))
})

router.post(userApi('/recommend'), async (ctx) => {
  const list = await user.findMany({
    include: {
      articles: {
        select: {
          viewCount: true
        }
      }
    }
  })
  const newList = list.map(({ articles, password, ...rest }) => ({
    totalViewCount: sumViewCounts(articles),
    ...rest
  }))

  response.success(ctx, withList(newList, newList.length))
})

router.post(userApi('/detail'), async (ctx) => {
  const { id }: Identity = ctx.request.body

  if (!id) throw new Error('参数不正确')

  const result = await user.findUnique({
    where: { id: Number(id) },
    select: {
      desc: true,
      name: true,
      role: true,
      avatar: true
    }
  })
  if (result) {
    response.success(ctx, result)
    return
  }

  response.success(ctx, null, '用户不存在')
})

router.post(userApi('/all'), async (ctx) => {
  const list = await user.findMany()
  response.success(
    ctx,
    withList(
      list.map(({ password, ...rest }) => rest),
      list.length
    )
  )
})

export const sum = (a: number, b: number) => a + b
const sumViewCounts = compose(
  reduce(sum, 0),
  map(prop('viewCount') as (...args: unknown[]) => number)
)

router.post(userApi('/card'), async (ctx) => {
  const { id } = ctx.request.body

  if (!id) throw new Error('参数不正确')

  const data = await user.findUnique({
    where: {
      id
    },
    include: {
      articles: {
        select: {
          viewCount: true
        }
      }
    }
  })
  if (!data) {
    response.success(ctx, null)
    return
  }
  const { articles, password, ...rest } = data
  response.success(ctx, {
    totalViewCount: sumViewCounts(articles),
    ...rest
  })
})
