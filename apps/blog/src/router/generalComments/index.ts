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
    content,
    type,
    userId,
    replyToUserId,
    moduleId,
    parentCommentId
  }: Prisma.GeneralCommentUncheckedCreateInput = ctx.request.body

  if ([content, type, userId, moduleId].some(anyPass([isEmpty, isNil]))) {
    response.error(ctx, 400, '参数错误')
    return
  }
  await generalComment.create({
    data: {
      type,
      content,
      userId,
      replyToUserId,
      moduleId,
      parentCommentId
    }
  })
  const user = ctx.state.user
  const momentDetail = await momentModel.findUnique({
    where: {
      id: moduleId
    },
    include: {
      timeline: true
    }
  })
  // 回复的评论
  const isSelfReply = momentDetail?.timeline?.userId !== user?.id
  if (momentDetail && !isSelfReply) {
    message.create({
      data: {
        senderId: user?.id,
        // 如果replyUserId存在， 则是回复的对应的评论
        receiverId: replyToUserId || momentDetail.timeline?.userId,
        content,
        type: replyToUserId ? 'momentReply' : 'moment',
        extra: {
          momentId: momentDetail.id,
          timelineId: momentDetail.timeline?.id
        }
      }
    })
  }
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
