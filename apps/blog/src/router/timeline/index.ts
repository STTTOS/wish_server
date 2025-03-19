import Moment from 'moment'
import { pick, isNil, equals } from 'ramda'
import { Prisma } from '@prisma/blog-client'

import router from '../instance'
import { FindTimelineInput } from './interface'
import combinePath from '../../utils/combinePath'
import { apiPrefix, timeFormat } from '../../config'
import response, { withList } from '@/utils/response'
import { PrismaError, WithPaginationReq } from '../interface'
import { moment, message, timeline, momentLike } from '@/models'

const timelineApi = combinePath(apiPrefix)('/timeline')

router.post(timelineApi('/create'), async (ctx) => {
  const { title, desc, cover, order, coUserIds }: Prisma.TimelineCreateInput =
    ctx.request.body
  const userId = ctx.state.user?.id
  if (!title || !userId || (coUserIds && !Array.isArray(coUserIds))) {
    response.error(ctx, 400, '参数错误')
    return
  }
  const { id } = await timeline.create({
    data: {
      title,
      desc,
      userId,
      cover,
      order,
      coUserIds
    }
  })
  response.success(ctx, { id })
})

router.post(timelineApi('/update/:id'), async (ctx) => {
  const id = Number(ctx.params.id)
  const userId = ctx.state.user?.id
  if (!(await canEdit({ timelineId: id }, userId))) {
    response.error(ctx, 403, '非法操作')
    return
  }

  const { title, cover, desc, order, coUserIds } = ctx.request.body
  if (!title || (coUserIds && !Array.isArray(coUserIds))) {
    response.error(ctx, 400, '参数错误')
    return
  }
  await timeline.update({
    where: {
      id
    },
    data: {
      title,
      cover,
      desc,
      order,
      coUserIds
    }
  })
  response.success(ctx)
})
router.post(timelineApi('/delete/:id'), async (ctx) => {
  const id = Number(ctx.params.id)
  const userId = ctx.state.user?.id
  if (!(await canEdit({ timelineId: id }, userId))) {
    response.error(ctx, 403, '非法操作')
    return
  }

  await timeline.delete({
    where: { id }
  })
  response.success(ctx)
})

// 分页查询时间轴
router.post(timelineApi('/list'), async (ctx) => {
  const {
    pageSize: take,
    current: skip,
    title,
    createdAt
  }: WithPaginationReq &
    Pick<Prisma.TimelineCreateInput, 'title'> & {
      createdAt: null | [string, string]
    } = ctx.request.body

  const total = await timeline.count()
  const list = await timeline.findMany({
    take,
    orderBy: [
      // 默认取最新修改的
      { updatedAt: 'desc' }
    ],
    where: {
      title: {
        contains: title
      },
      createdAt: createdAt
        ? {
            gte: createdAt[0],
            lte: createdAt[1]
          }
        : undefined
    },
    skip: (skip! - 1) * take!,
    include: {
      user: {
        select: {
          username: true,
          name: true,
          id: true
        }
      }
    }
  })
  response.success(
    ctx,
    withList(
      list.map((item) => ({
        ...item,
        createdAt: Moment(item.createdAt).format(timeFormat),
        updatedAt: Moment(item.updatedAt).format(timeFormat)
      })),
      total
    )
  )
})
// 查询用户所有的时间轴
router.post(timelineApi('/all/:userId'), async (ctx) => {
  const userId = Number(ctx.params.userId)
  const list = await timeline.findMany({
    where: { userId }
  })
  response.success(ctx, list)
})
// 查询时间轴详情
router.post(timelineApi('/detail/:timelineId'), async (ctx) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { timelineId }: any = ctx.params
  const data = await timeline.findUnique({
    where: {
      id: Number(timelineId)
    },
    include: {
      user: {
        select: {
          username: true,
          name: true,
          id: true,
          avatar: true
        }
      }
    }
  })
  if (!data) {
    response.error(ctx, 404, '资源不存在')
    return
  }
  response.success(ctx, data)
})

router.post(timelineApi('/moment/add/:timelineId'), async (ctx) => {
  const timelineId = Number(ctx.params.timelineId)

  const {
    content,
    cover,
    createdAt,
    images,
    isPrivate
  }: // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Omit<Prisma.MomentCreateInput, 'images'> & { images: any[] } =
    ctx.request.body

  const userId = ctx.state.user?.id

  if (
    [userId, timelineId, createdAt].some(isNil) ||
    [!content, images.length === 0].every(equals(true))
  ) {
    response.error(ctx, 400, '参数错误')
    return
  }
  if (!(await canEdit({ timelineId }, userId))) {
    response.error(ctx, 403, '非法操作')
    return
  }

  await timeline.update({
    where: { id: timelineId },
    data: {
      updatedAt: new Date()
    }
  })
  const { id } = await moment.create({
    data: {
      content,
      cover,
      createdAt,
      isPrivate,
      ownerId: userId,
      images: {
        createMany: {
          data: images
        }
      },
      timelineId
    }
  })
  response.success(ctx, { id })
})

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const parseCoUserIds = (input: any) => {
  return Array.isArray(input) ? input : []
}
/**
 * @description 是否为本人操作
 * @returns
 */
async function canEdit(
  { momentId, timelineId }: { momentId?: number; timelineId?: number },
  userId?: number
) {
  if (momentId) {
    const target = await moment.findUnique({
      where: {
        id: momentId
      },
      include: {
        timeline: {
          select: {
            userId: true,
            coUserIds: true
          }
        }
      }
    })
    return (
      userId === target?.timeline?.userId ||
      parseCoUserIds(target?.timeline?.coUserIds).includes(userId)
    )
  }
  const target = await timeline.findUnique({
    where: {
      id: timelineId
    }
  })
  return (
    userId === target?.userId ||
    parseCoUserIds(target?.coUserIds).includes(userId)
  )
}

router.post(timelineApi('/moment/update/:id'), async (ctx) => {
  const momentId = Number(ctx.params.id)
  const data: {
    timelineId: number
    images: { sort: number; src: string }[]
    isPrivate?: boolean
  } = ctx.request.body

  const userId = ctx.state.user?.id
  const { timelineId } = data
  if (!momentId || !timelineId) {
    response.error(ctx, 400, '参数错误')
    return
  }
  if (!(await canEdit({ momentId }, userId))) {
    response.error(ctx, 403, '非法操作')
    return
  }

  await timeline.update({
    where: { id: data.timelineId },
    data: {
      updatedAt: new Date()
    }
  })
  await moment.update({
    where: { id: momentId },
    data: {
      ...data,
      images: {
        deleteMany: {
          momentId
        },
        createMany: {
          data: data.images.map((props) => pick(['sort', 'src'], props))
        }
      }
    }
  })
  response.success(ctx, { id: Number(momentId) })
})

router.post(timelineApi('/moment/delete/:id'), async (ctx) => {
  const id = Number(ctx.params.id)
  if (!id) {
    response.error(ctx, 400, '参数错误')
    return
  }

  const userId = ctx.state.user?.id
  if (!(await canEdit({ momentId: id }, userId))) {
    response.error(ctx, 403, '非法操作')
    return
  }

  await moment.delete({
    where: { id }
  })
  response.success(ctx, null, '删除成功')
})

// 点赞指定Moment
router.post(timelineApi('/moment/like/:momentId'), async (ctx) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { momentId: _momentId }: any = ctx.params
  const { timelineId: _timelineId } = ctx.request.body

  // 此接口需要做登录拦截
  const userId = ctx.state.user!.id
  if (!_momentId || !_timelineId) {
    response.error(ctx, 400, '参数错误')
    return
  }
  const [momentId, timelineId] = [_momentId, _timelineId].map(Number)
  const data = await moment.findUnique({
    where: { id: momentId },
    include: {
      likes: true,
      timeline: {
        include: {
          user: true
        }
      }
    }
  })
  try {
    await momentLike.create({
      data: {
        userId,
        momentId
      }
    })
  } catch (error) {
    if ((error as PrismaError).code === 'P2002') {
      response.error(ctx, 10001, '不可重复点赞')
      return
    }
  }

  if (userId !== data?.timeline?.userId)
    await message.create({
      data: {
        content: '点赞了你的时刻',
        type: 'like',
        receiverId: data?.timeline?.userId,
        senderId: userId,
        extra: {
          momentId,
          timelineId
        }
      }
    })
  response.success(ctx)
})

router.post(timelineApi('/moment/share/:id'), async (ctx) => {
  const _id = ctx.params.id
  if (!_id) {
    response.error(ctx, 400, '参数错误')
    return
  }
  const detail = await moment.findUnique({
    where: {
      id: Number(_id)
    },
    include: {
      images: true
    }
  })
  if (!detail) {
    response.error(ctx, 404, '资源不存在')
    return
  }
  response.success(ctx, {
    ...detail,
    createdAt: Moment(detail.createdAt).format(timeFormat)
    // updatedAt: Moment(detail.updatedAt).format(timeFormat)
  })
})

// 分页查询指定 timeline下的的 moments
router.post(timelineApi('/moment/:timelineId'), async (ctx) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { timelineId }: any = ctx.params
  const {
    pageSize: take,
    current: _skip,
    keyword
  }: Omit<FindTimelineInput, 'order'> & {
    keyword?: string
    order?: 'desc' | 'asc'
  } = ctx.request.body

  const user = ctx.state.user

  // 不允许一次性请求超过3条数据
  const skip = Math.min(100, Number(_skip))
  if ([timelineId, take, skip].some(isNil)) {
    response.error(ctx, 400, '参数错误')
    return
  }

  const timelineWhere: Prisma.TimelineWhereInput = {
    id: Number(timelineId)
  }
  const where: Prisma.MomentWhereInput = {
    AND: [
      { timeline: timelineWhere },
      { content: keyword ? { contains: keyword } : undefined },
      {
        OR: [
          {
            timeline: {
              userId: user?.id
            }
          },
          { isPrivate: false }
        ]
      }
    ]
  }
  const total = await moment.count({
    where
  })
  const order =
    (
      await timeline.findUnique({
        where: {
          id: Number(timelineId)
        },
        select: {
          order: true
        }
      })
    )?.order || 'desc'

  const list = await moment.findMany({
    take,
    skip: (skip! - 1) * take!,
    where,
    include: {
      images: true,
      likes: {
        include: {
          user: {
            select: {
              id: true,
              avatar: true
            }
          }
        }
      },
      timeline: {
        select: {
          userId: true
        }
      },
      owner: {
        select: {
          avatar: true,
          id: true
        }
      }
    },
    orderBy: {
      createdAt: order
    }
  })
  response.success(
    ctx,
    withList(
      list.map(({ likes, timeline, ...props }) => ({
        ...props,
        likes: likes.map((item) => item.user),
        userId: timeline?.userId
      })),
      total
    )
  )
})

// 获取当前用户所有的时间轴
router.post(timelineApi('/currentUser/all'), async (ctx) => {
  const user = ctx.state.user!

  const timelines = await timeline.findMany({
    where: {
      userId: user.id
    }
  })
  response.success(ctx, timelines.map(pick(['id', 'title'])))
})

// 将moment迁移到指定的timeline下
router.post(timelineApi('/moment/migrate/:id'), async (ctx) => {
  const timelineId = Number(ctx.params.id)

  const {
    content,
    cover,
    createdAt,
    images,
    momentId
  }: // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Prisma.MomentCreateInput & { images: any[]; momentId: number } =
    ctx.request.body
  const userId = ctx.state.user?.id
  if (
    !content ||
    !userId ||
    !createdAt ||
    !timelineId ||
    !momentId ||
    [!content, images.length === 0].every(equals(true))
  ) {
    response.error(ctx, 400, '参数错误')
    return
  }

  const target = await timeline.findUnique({
    where: {
      id: timelineId
    }
  })
  if (!target) {
    response.error(ctx, 10002, '时间轴不存在')
    return
  }

  if (!(await canEdit({ momentId }, userId))) {
    response.error(ctx, 403, '非法操作')
    return
  }

  await timeline.update({
    where: { id: timelineId },
    data: {
      updatedAt: new Date()
    }
  })
  const { id } = await moment.create({
    data: {
      content,
      cover,
      createdAt,
      images: {
        createMany: {
          data: images?.map(({ sort, src }) => ({ sort, src }))
        }
      },
      timelineId
    }
  })
  await moment.delete({
    where: {
      id: Number(momentId)
    }
  })

  response.success(ctx, { id })
})

// 获取所有的moments, 按照创建时间倒序
router.post(timelineApi('/moments'), async (ctx) => {
  const { pageSize: take, current: skip }: WithPaginationReq = ctx.request.body

  const user = ctx.state.user
  const total = await moment.count()
  const rows = await moment.findMany({
    take,
    skip: (skip! - 1) * take!,
    orderBy: {
      createdAt: 'desc'
    },
    where: {
      OR: [
        {
          timeline: {
            userId: user?.id
          }
        },
        { isPrivate: false }
      ]
    },
    include: {
      images: true,
      likes: {
        include: {
          user: {
            select: {
              id: true,
              avatar: true
            }
          }
        }
      },
      owner: {
        select: {
          avatar: true,
          id: true
        }
      },
      timeline: {
        select: {
          user: {
            select: {
              avatar: true,
              id: true,
              name: true
            }
          }
        }
      }
    }
  })
  const list = rows.map((item) => ({
    ...item,
    createdAt: Moment(item.createdAt).format(timeFormat),
    likes: item.likes?.map((item) => item.user),
    userId: item.timeline?.user?.id
  }))
  response.success(ctx, withList(list, total))
})

router.post(timelineApi('/moments/unReadCount'), async (ctx) => {
  const { startDate } = ctx.request.body

  const user = ctx.state.user
  const count = await moment.count({
    where: {
      createdAt: {
        gte: startDate
      },
      OR: [
        {
          timeline: {
            userId: user?.id
          }
        },
        { isPrivate: false }
      ]
    }
  })
  response.success(ctx, count)
})
