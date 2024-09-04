import Moment from 'moment'
import { pick, isNil, equals } from 'ramda'
import { Prisma } from '@prisma/blog-client'

import router from '../instance'
import { FindTimelineInput } from './interface'
import { WithPaginationReq } from '../interface'
import combinePath from '../../utils/combinePath'
import { apiPrefix, timeFormat } from '../../config'
import response, { withList } from '@/utils/response'
import { moment, message, timeline, momentLike } from '@/models'

const timelineApi = combinePath(apiPrefix)('/timeline')

router.post(timelineApi('/create'), async (ctx) => {
  const { title, desc, cover }: Prisma.TimelineCreateInput = ctx.request.body
  const userId = ctx.state.user?.id
  if (!title || !userId) {
    response.error(ctx, 400, '参数错误')
    return
  }
  const { id } = await timeline.create({
    data: {
      title,
      desc,
      userId,
      cover
    }
  })
  response.success(ctx, { id })
})

router.post(timelineApi('/update/:id'), async (ctx) => {
  const id = Number(ctx.params.id)
  const userId = ctx.state.user?.id
  if (!(await isSameUser({ timelineId: id }, userId))) {
    response.error(ctx, 403, '非法操作')
    return
  }

  const { title, cover, desc } = ctx.request.body
  if (!title) {
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
      desc
    }
  })
  response.success(ctx)
})
router.post(timelineApi('/delete/:id'), async (ctx) => {
  const id = Number(ctx.params.id)
  const userId = ctx.state.user?.id
  if (!(await isSameUser({ timelineId: id }, userId))) {
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
  const { pageSize: take, current: skip }: WithPaginationReq = ctx.request.body
  const total = await timeline.count()
  const list = await timeline.findMany({
    take,
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
        createdAt: Moment(item.createdAt).format(timeFormat)
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
    images
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
  if (!(await isSameUser({ timelineId }, userId))) {
    response.error(ctx, 403, '非法操作')
    return
  }

  await moment.create({
    data: {
      content,
      cover,
      createdAt,
      images: {
        createMany: {
          data: images
        }
      },
      timelineId
    }
  })
  response.success(ctx)
})

async function isSameUser(
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
            userId: true
          }
        }
      }
    })
    return userId === target?.timeline?.userId
  }
  const target = await timeline.findUnique({
    where: {
      id: timelineId
    }
  })
  return userId === target?.userId
}
router.post(timelineApi('/moment/update/:id'), async (ctx) => {
  const momentId = Number(ctx.params.id)
  const data = ctx.request.body
  const userId = ctx.state.user?.id

  if (!(await isSameUser({ momentId }, userId))) {
    response.error(ctx, 403, '非法操作')
    return
  }
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
  response.success(ctx)
})

router.post(timelineApi('/moment/delete/:id'), async (ctx) => {
  const id = Number(ctx.params.id)
  if (!id) {
    response.error(ctx, 400, '参数错误')
    return
  }

  const userId = ctx.state.user?.id
  if (!(await isSameUser({ momentId: id }, userId))) {
    response.error(ctx, 403, '非法操作')
    return
  }

  await moment.delete({
    where: { id }
  })
  response.success(ctx, null, '删除成功')
})

// 分页查询指定 timeline下的的 moments
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
      timeline: {
        include: {
          user: true
        }
      }
    }
  })
  await momentLike.create({
    data: {
      userId,
      momentId
    }
  })

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
      timeline: {
        include: {
          user: true
        }
      }
    }
  })
  await momentLike.create({
    data: {
      userId,
      momentId
    }
  })

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

// 分页查询指定 timeline下的的 moments
router.post(timelineApi('/moment/:timelineId'), async (ctx) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { timelineId }: any = ctx.params
  const { pageSize: take, current: _skip }: FindTimelineInput = ctx.request.body

  // 不允许一次性请求超过3条数据
  const skip = Math.min(100, Number(_skip))
  if ([timelineId, take, skip].some(isNil)) {
    response.error(ctx, 400, '参数错误')
    return
  }

  const where: Prisma.TimelineWhereInput = {
    id: Number(timelineId)
  }
  const total = await moment.count({
    where: { timeline: where }
  })
  const list = await moment.findMany({
    take,
    skip: (skip! - 1) * take!,
    where: {
      timeline: where
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
      }
    },
    orderBy: {
      createdAt: 'desc'
    }
  })
  response.success(
    ctx,
    withList(
      list.map(({ likes, ...props }) => ({
        ...props,
        likes: likes.map((item) => item.user)
      })),
      total
    )
  )
})
