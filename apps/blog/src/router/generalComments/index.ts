import moment from 'moment'
import { Prisma } from '@prisma/blog-client'
import { isNil, anyPass, isEmpty } from 'ramda'

import router from '../instance'
import { Identity } from '../interface'
import response from '@/utils/response'
import combinePath from '@/utils/combinePath'
import { apiPrefix, timeFormat } from '@/config'
import { message, generalComment, moment as momentModel } from '@/models'

const generalCommentApi = combinePath(apiPrefix)('/generalComment')

router.post(generalCommentApi('/add'), async (ctx) => {
  const {
    type,
    content,
    moduleId,
    replyToUserId,
    parentCommentId
  }: Prisma.GeneralCommentUncheckedCreateInput = ctx.request.body

  if ([content, type, moduleId].some(anyPass([isEmpty, isNil]))) {
    response.error(ctx, 400, '参数错误')
    return
  }
  const user = ctx.state.user
  const userId = user!.id
  await generalComment.create({
    data: {
      type,
      userId,
      content,
      moduleId,
      replyToUserId,
      parentCommentId
    }
  })
  const momentDetail = await momentModel.findUnique({
    where: {
      id: moduleId
    },
    include: {
      timeline: true
    }
  })

  if (!momentDetail) {
    response.error(ctx, 404, 'moment不存在')
    return
  }

  if (parentCommentId) {
    const parentComment = await generalComment.findUnique({
      where: {
        id: parentCommentId
      }
    })
    if (!parentComment) {
      response.error(ctx, 404, '回复的评论不存在')
      return
    }
  }

  // 1. 回复非自己的评论
  // 2. 评论非自己的moment
  // 以上这两种情况不推送消息
  const replyToOthers = replyToUserId && replyToUserId !== userId
  const replyCommentOfOthers = !replyToUserId && userId !== momentDetail.ownerId
  if (replyToOthers || replyCommentOfOthers)
    await message.create({
      data: {
        senderId: user?.id,
        // 如果replyUserId存在， 则是回复的对应的评论
        receiverId: replyToUserId || momentDetail.ownerId,
        content,
        type: replyToUserId ? 'momentReply' : 'moment',
        extra: {
          momentId: momentDetail.id,
          timelineId: momentDetail.timeline?.id
        }
      }
    })
  response.success(ctx)
})

router.post(generalCommentApi('/delete'), async (ctx) => {
  const { id }: Identity = ctx.request.body

  if (!id) {
    response.error(ctx, 400, '参数错误')
    return
  }
  const user = ctx.state.user

  const detail = await generalComment.findUnique({
    where: {
      id
    },
    include: {
      user: true
    }
  })
  if (!detail) {
    response.success(ctx)
    return
  }

  if (detail?.user.id !== user?.id) {
    response.error(ctx, 403, '非法操作')
    return
  }

  await generalComment.delete({
    where: {
      id
    }
  })
  response.success(ctx)
})

// 查询指定模块下的所有评论
router.post(generalCommentApi('/all/:id'), async (ctx) => {
  const { type }: Prisma.GeneralCommentUncheckedCreateInput = ctx.request.body

  const moduleId = Number(ctx.params.id)

  if (!type) {
    response.error(ctx, 400, '参数错误')
    return
  }

  const list = await generalComment.findMany({
    where: {
      type,
      moduleId
    },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          avatar: true
        }
      },
      replyToUser: {
        select: {
          id: true,
          name: true
        }
      }
    }
  })
  const result = list.map((item) => {
    return {
      ...item,
      createdAt: moment(item.createdAt).format(timeFormat)
    }
  })
  response.success(ctx, result)
})

router.post(generalCommentApi('/delete/:id'), async (ctx) => {
  const id = Number(ctx.params.id)

  if (!id) {
    response.error(ctx, 400, '参数错误')
    return
  }
  const detail = await generalComment.findUnique({
    where: {
      id
    }
  })
  const user = ctx.state.user

  if (user?.id !== detail?.userId) {
    response.error(ctx, 403, '非法操作')
  }
  try {
    await generalComment.delete({
      where: { id }
    })
    response.success(ctx)
  } catch (error: unknown) {
    const { code } = error as { code: string }

    const errMsg = (() => {
      if (code === 'P2025') return '评论不存在'
      return '系统异常'
    })()
    response.error(ctx, 500, errMsg)
  }
})
