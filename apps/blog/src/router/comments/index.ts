import type { Identity } from '../interface'

import moment from 'moment'
import { not, prop, includes } from 'ramda'
import { Prisma } from '@prisma/blog-client'

import router from '../instance'
import prisma from '../../models'
import { Comment } from './interface'
import { tag, article } from '../../models'
import response from '../../utils/response'
import { withList } from '../../utils/response'
import { parseUserInfoByCookie } from '../user'
import combinePath from '../../utils/combinePath'
import {
  apiPrefix,
  timeFormat,
  wordsToMinuteBaseNumber,
  timeFormatWithoutSeconds
} from '../../config'

const commentApi = combinePath(apiPrefix)('/comment')

router.post(commentApi('/add'), async (ctx) => {
  const {
    content,
    articleId,
    parentCommentId = null
  }: Comment = ctx.request.body
  const { cookie } = ctx.request.header
  const user = await parseUserInfoByCookie(cookie)

  if (!user) throw new Error('未登录')

  const { id: authorId } = user

  await prisma.comment.create({
    data: {
      content,
      authorId,
      articleId,
      parentCommentId
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
  response.success(
    ctx,
    withList(formatComments(comments), comments.length || 0)
  )
})
function formatComments(list: any[]): any[] {
  return list?.map(({ createdAt, author, ...rest }) => ({
    ...rest,
    createdAt: moment(createdAt).format(timeFormat),
    name: author.name,
    avatar: author.avatar,
    replies: formatComments(rest.replies)
  }))
}
