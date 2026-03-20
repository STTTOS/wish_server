import type { Identity, PrismaError } from '../interface'
import type { UpdateUserReq, GetUserByPaginationReq } from './interface'

import { v4 } from 'uuid'
import moment from 'moment'
import Cookie from 'cookie'
import { Context } from 'koa'
import { SHA256 } from 'crypto-js'
import { User, Prisma } from '@prisma/blog-client'
import { map, prop, omit, pick, reduce, compose } from 'ramda'

import router from '../instance'
import response from '../../utils/response'
import { withList } from '../../utils/response'
import combinePath from '../../utils/combinePath'
import prisma, { user, article } from '../../models'
import { decrypt, encrypt } from '../../utils/jwtCryptor'
import { apiPrefix, timeFormat, tokenValidatedTime } from '../../config'

const userApi = combinePath(apiPrefix)('/user')

async function getUserInfo(id?: number) {
  try {
    if (!id) return null
    return user.findUnique({ where: { id } })
  } catch (error) {
    return null
  }
}
function setCookie(
  ctx: Context,
  payload: Pick<User, 'id'> & { sessionId: string },
  keepLogin: boolean
) {
  const token = encrypt(pick(['id', 'sessionId'])(payload))
  ctx.cookies.set('token', token, {
    httpOnly: true,
    expires: keepLogin
      ? new Date(Date.now() + tokenValidatedTime * 1000)
      : undefined
  })
}

export const loginUsers = new Map<number, { sessionId: string; time: string }>()
// 登录注册 合并一起
router.post(userApi('/signin'), async (ctx) => {
  const { username, password, keepLogin } = ctx.request.body

  if (!username || !password) throw new Error('参数异常')

  const u = await user.findFirst({
    where: { username }
  })

  const sessionId = v4()
  const time = moment().format(timeFormat)
  // 验证登录
  if (u) {
    const target = await user.findFirst({ where: { username, password } })
    if (!target) {
      response.error(ctx, 1000, '用户信息不正确')
      return
    }
    loginUsers.set(target.id!, { sessionId, time })
    setCookie(ctx, { ...target, sessionId }, keepLogin)
    response.success(ctx, null, '登录成功')
    return
  }

  // 注册
  const userInfo = await user.create({
    data: {
      username,
      password,
      name: `用户_${sessionId.slice(0, 6)}_` + moment().format('yyyy-MM-DD')
    }
  })

  loginUsers.set(userInfo.id!, { sessionId, time })
  setCookie(ctx, { ...userInfo, sessionId }, keepLogin)
  response.success(ctx, null, '注册成功')
})

router.post(userApi('/logout'), async (ctx) => {
  ctx.cookies.set('token', null)
  const userId = ctx.state.user?.id
  if (userId) loginUsers.delete(userId)

  response.success(ctx)
})

router.post(userApi('/resetPwd'), async (ctx) => {
  const { id } = ctx.request.body

  await prisma.user.update({
    where: { id },
    data: { password: SHA256('12345678').toString() }
  })
  response.success(ctx)
})

router.post(userApi('/info'), async (ctx) => {
  const { cookie } = ctx.request.header
  try {
    const payload = decrypt(Cookie.parse(cookie || '').token)
    const data = await getUserInfo(payload?.id)
    response.success(ctx, omit(['password', 'secureKey'], data))
  } catch (error) {
    response.success(ctx)
  }
})

// 俩接口返回一样, 但是此接口受权限控制, 若token无效, 会返回401/403, 让客户端重定向
router.post(userApi('/loginCheck'), async (ctx) => {
  const data = await getUserInfo(ctx.state.user?.id)
  response.success(ctx, omit(['password', 'secureKey'], data))
})

router.post(userApi('/add'), async (ctx) => {
  const { name, ...data } = ctx.request.body

  if (!name) throw new Error('昵称不能为空')

  try {
    await user.create({ data: { ...data, name } })
    response.success(ctx)
  } catch (error) {
    const { code } = error as PrismaError

    if (code === 'P2002') {
      response.error(ctx, 10000, '账户名/昵称重复')
      return
    }
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

  const userId = ctx.state.user?.id

  if (id !== userId) throw new Error('非法操作')

  try {
    await user.update({
      data: { ...data, name },
      where: { id: Number(id) }
    })
    response.success(ctx, null)
  } catch (error) {
    const { code } = error as PrismaError
    if (code === 'P2002') {
      response.error(ctx, 10000, '账户名/昵称重复')
      return
    }

    response.success(ctx, null, '用户不存在')
  }
})

router.post(userApi('/list'), async (ctx) => {
  const { name, email, time, current, pageSize, role }: GetUserByPaginationReq =
    ctx.request.body

  if (!current || !pageSize) throw new Error('分页参数不正确')

  const where: Prisma.UserWhereInput = { role }
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
  const newList = list.map(({ createdAt, articles, ...rest }) => ({
    ...omit(['password', 'secureKey'], rest),
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
  const newList = list.map(({ articles, ...rest }) => ({
    ...omit(['password', 'secureKey'], rest),
    totalViewCount: sumViewCounts(articles)
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
    withList(list.map(omit(['password', 'secureKey'])), list.length)
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
  const { articles, ...rest } = data
  response.success(ctx, {
    totalViewCount: sumViewCounts(articles),
    ...omit(['password', 'secureKey'], rest)
  })
})

router.post(userApi('/veirfySecureKey'), async (ctx) => {
  const { secureKey, id } = ctx.request.body
  // 如果未带入id, 则查询用户的securekey
  if (!id) {
    const data = await user.findUnique({
      where: {
        id: ctx.state.user?.id
      }
    })
    const accessKey = data?.secureKey
    response.success(ctx, { access: accessKey && accessKey === secureKey })
    return
  }

  const data = await article.findUnique({
    where: { id: Number(id) },
    include: { author: { select: { secureKey: true } } }
  })
  const accessKey = data?.author?.secureKey
  response.success(ctx, { access: accessKey && secureKey === accessKey })
})
