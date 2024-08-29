import moment from 'moment'
import { Comment } from '@prisma/blog-client'

import router from '../instance'
import { logger } from '@/logger'
import response from '../../utils/response'
import { withList } from '../../utils/response'
import combinePath from '../../utils/combinePath'
import { apiPrefix, timeFormat } from '../../config'
import prisma, { comment, message } from '../../models'

const commentApi = combinePath(apiPrefix)('/comment')

router.post(commentApi('/add'), async (ctx) => {
  const {
    rootId,
    articleId,
    content,
    parentCommentId = null
  }: // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Comment & { content: Record<string, any> } = ctx.request.body

  const authorId = ctx.state.user!.id

  const receiver = await (() => {
    if (parentCommentId)
      return prisma.comment.findUnique({
        where: { id: parentCommentId },
        include: { author: { select: { id: true } } }
      })
    return prisma.article.findUnique({
      where: { id: articleId },
      include: { author: { select: { id: true } } }
    })
  })()
  // 通过文章id查询对应user
  const { id } = await prisma.comment.create({
    data: {
      rootId,
      authorId,
      articleId,
      body: content,
      parentCommentId
    }
  })
  await message.create({
    data: {
      content: content.message,
      senderId: authorId,
      receiverId: receiver?.author?.id,
      type: parentCommentId ? 'reply' : 'comment',
      extra: {
        articleId,
        commentId: id
      }
    }
  })
  response.success(ctx)
})

router.post(commentApi('/list'), async (ctx) => {
  const { articleId }: Pick<Comment, 'articleId'> = ctx.request.body

  if (!articleId) throw new Error('参数不正确')

  const comments = await prisma.comment.findMany({
    where: {
      articleId,
      rootId: {
        equals: null
      }
    },
    orderBy: {
      createdAt: 'asc'
    },
    include: {
      author: {
        select: {
          avatar: true,
          username: true,
          name: true,
          isContributor: true
        }
      },
      children: {
        include: {
          parentComment: {
            include: {
              author: {
                select: {
                  name: true,
                  id: true
                }
              }
            }
          },
          author: {
            select: {
              avatar: true,
              username: true,
              name: true,
              isContributor: true
            }
          }
        }
      }
    }
  })
  const count = await prisma.comment.count({
    where: {
      articleId
    }
  })
  response.success(ctx, withList(formatComments(comments), count))
})

router.post(commentApi('/delete'), async (ctx) => {
  const { id } = ctx.request.body
  const target = await comment.findUnique({ where: { id } })

  const user = ctx.state.user
  // 判定必须本人操作
  if (!user || !target || target.authorId !== user.id) {
    response.error(ctx, 500, '非法操作')
    return
  }
  if (!id) {
    response.error(ctx, 500, '参数不正确')
    return
  }

  const childrenIds = await comment.findMany({
    where: {
      OR: [{ parentCommentId: id }, { rootId: id }]
    }
  })
  await comment.deleteMany({
    where: { id: { in: [id].concat(childrenIds.map((item) => item.id)) } }
  })
  response.success(ctx)
})

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function formatComments(list: any[]): any[] {
  return list?.map(({ createdAt, author, body, parentComment, ...rest }) => {
    return {
      ...rest,
      content: body,
      createdAt: moment(createdAt).format(timeFormat),
      name: author.name,
      avatar: author.avatar,
      isContributor: author.isContributor,
      children: formatComments(rest.children),
      parentUser: parentComment?.author
    }
  })
}

// 处理历史数据, 将content映射到body
comment.findMany().then((res) => {
  res.forEach(async (item) => {
    await comment.update({
      where: { id: item.id },
      data: {
        /* eslint-disable  @typescript-eslint/no-explicit-any */
        content: item.body as any
      }
    })
    logger.log(
      `body => content: ${item.id}=${item.content} update successfully`
    )
  })
})
