import moment from 'moment'
import { Comment } from '@prisma/blog-client'

import router from '../instance'
import response from '../../utils/response'
import { withList } from '../../utils/response'
// import { Comment } from './interface'
import combinePath from '../../utils/combinePath'
import { apiPrefix, timeFormat } from '../../config'
import prisma, { comment, message } from '../../models'

const commentApi = combinePath(apiPrefix)('/comment')

router.post(commentApi('/add'), async (ctx) => {
  const {
    content,
    articleId,
    parentCommentId = null
  }: Comment = ctx.request.body

  const user = ctx.userInfo
  if (!user) throw new Error('未登录')

  const { id: authorId } = user

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
  await prisma.comment.create({
    data: {
      content,
      authorId,
      articleId,
      parentCommentId
    }
  })
  await message.create({
    data: {
      articleId,
      senderId: user.id,
      receiverId: receiver?.author?.id,
      type: parentCommentId ? 'reply' : 'comment',
      content
    }
  })
  response.success(ctx)
})

router.post(commentApi('/list'), async (ctx) => {
  const { articleId }: Pick<Comment, 'articleId'> = ctx.request.body

  if (!articleId) throw new Error('参数不正确')

  // const post = await prisma.article.findUnique({
  //   where: {
  //     id: articleId
  //   },
  //   include: {
  //     comments: {
  //       where: {
  //         parentCommentId: {
  //           equals: null
  //         }
  //       },
  //       include: {
  //         replies: {
  //           include: {
  //             author: {
  //               select: {
  //                 avatar: true,
  //                 username: true
  //               }
  //             }
  //           }
  //         },
  //         author: {
  //           select: {
  //             avatar: true,
  //             username: true
  //           }
  //         }
  //       }
  //     }
  //   }
  // })
  const comments = await prisma.comment.findMany({
    where: {
      articleId,
      parentCommentId: {
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
      replies: {
        include: {
          author: {
            select: {
              avatar: true,
              username: true,
              name: true
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
  const { id, hasChildren } = ctx.request.body
  const target = await comment.findUnique({ where: { id } })

  const user = ctx.userInfo
  // 判定必须本人操作
  if (!user || !target || target.authorId !== user.id) {
    response.error(ctx, 500, '非法操作')
    return
  }
  if (!id) {
    response.error(ctx, 500, '参数不正确')
    return
  }

  // 如果有子评论, 跟着一起删除
  if (hasChildren) {
    const childrenIds = await comment.findMany({
      where: { parentCommentId: id }
    })
    await comment.deleteMany({
      where: { id: { in: childrenIds.map((item) => item.id).concat(id) } }
    })
  } else {
    await comment.delete({ where: { id } })
  }
  response.success(ctx)
})

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function formatComments(list: any[]): any[] {
  return list?.map(({ createdAt, author, ...rest }) => ({
    ...rest,
    createdAt: moment(createdAt).format(timeFormat),
    name: author.name,
    avatar: author.avatar,
    replies: formatComments(rest.replies)
  }))
}
