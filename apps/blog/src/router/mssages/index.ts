import moment from 'moment'
import { Prisma } from '@prisma/blog-client'

import router from '../instance'
import { message } from '../../models'
import combinePath from '../../utils/combinePath'
import { apiPrefix, timeFormat } from '../../config'
import response, { withList } from '../../utils/response'

const messageApi = combinePath(apiPrefix)('/message')

router.post(messageApi('/list'), async (ctx) => {
  const { current: skip, pageSize: take } = ctx.request.body
  if (!take || !skip) {
    response.error(ctx, 400, '参数错误')
    return
  }

  const user = ctx.state.user

  const where: Prisma.MessageWhereInput = {
    OR: [{ receiverId: user!.id }, { type: 'system' }]
  }
  const list = await message.findMany({
    where,
    take,
    skip: (skip - 1) * take,
    orderBy: {
      createdAt: 'desc'
    },
    include: {
      sender: {
        select: {
          name: true,
          avatar: true
        }
      }
    }
  })
  const total = await message.count({ where })
  response.success(
    ctx,
    withList(
      list.map(({ createdAt, extra, readBy, ...rest }) => {
        return {
          ...rest,
          extra,
          isRead: (readBy as number[]).includes(ctx.state.user!.id),
          createdAt: moment(createdAt).format(timeFormat)
        }
      }),
      total
    )
  )
})

router.post(messageApi('/read'), async (ctx) => {
  const { id } = ctx.request.body

  if (!id) throw new Error('参数异常')

  const data = await message.findUnique({
    where: { id }
  })
  // 需要验证这条消息的归属是否为本人
  if (data?.receiverId && data.receiverId !== ctx.state.user!.id) {
    response.error(ctx, 400, '非法操作')
    return
  }
  await message.update({
    where: {
      id
    },
    data: {
      readBy: Array.from(
        new Set(((data?.readBy as number[]) || []).concat([ctx.state.user!.id]))
      )
    }
  })
  response.success(ctx)
})

// 获取全部未读消息
router.post(messageApi('/unread'), async (ctx) => {
  const user = ctx.state.user

  const where: Prisma.MessageWhereInput = {
    OR: [{ receiverId: user!.id }, { type: 'system' }],
    readBy: { equals: [] }
  }
  const total = await message.count({
    where
  })
  const list = await message.findMany({
    where,
    // 默认查询20条未读消息
    take: 20,
    include: {
      sender: {
        select: {
          name: true,
          avatar: true
        }
      }
    }
  })
  response.success(
    ctx,
    withList(
      list.map(({ createdAt, ...rest }) => ({
        createdAt: moment(createdAt).format(timeFormat),
        ...rest
      })),
      total
    )
  )
})

router.post(messageApi('/unreadCount'), async (ctx) => {
  const user = ctx.state.user
  const count = await message.count({
    where: {
      OR: [{ receiverId: user!.id }, { type: 'system' }],
      readBy: {
        equals: []
      }
    }
  })
  response.success(ctx, { count })
})

router.post(messageApi('/readAll'), async (ctx) => {
  const user = ctx.state.user
  await message.updateMany({
    where: {
      receiverId: user!.id
    },
    data: {
      readBy: [user!.id]
    }
  })
  response.success(ctx)
})

// 刷数据
message.findMany().then((list) => {
  list?.forEach(async (item) => {
    await message.update({
      where: {
        id: item.id
      },
      data: {
        readBy: item.receiverId ? [item.receiverId] : []
      }
    })
  })
})
