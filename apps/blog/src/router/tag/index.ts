import type { AddTagReq } from './interface'
import type { Identity } from '../interface'

import { Prisma } from '@prisma/blog-client'

import router from '../instance'
import { tag } from '../../models'
import { apiPrefix } from '../../config'
import response from '../../utils/response'
import { withList } from '../../utils/response'
import { WithPaginationReq } from '../interface'
import combinePath from '../../utils/combinePath'

const tagApi = combinePath(apiPrefix)('/tag')

router.post(tagApi('/add'), async (ctx) => {
  const { name, icon } = ctx.request.body

  if (!name) throw new Error('参数不正确')

  try {
    await tag.create({ data: { name, icon } })
    response.success(ctx)
  } catch (error) {
    response.success(ctx, null, '标签已存在', 520)
  }
})

router.post(tagApi('/delete'), async (ctx) => {
  const { id }: Identity & AddTagReq = ctx.request.body

  if (!id) throw new Error('参数不正确')

  try {
    await tag.delete({ where: { id } })
    response.success(ctx)
  } catch (error) {
    const { code } = error as any

    const errMsg = (() => {
      if (code === 'P2003') return '请先删除相关联的文章'
      else if (code === 'P2025') return 'Tag不存在'
      return '系统异常'
    })()
    response.success(ctx, null, errMsg, 500)
  }
})

router.post(tagApi('/update'), async (ctx) => {
  const { id, name, icon }: Identity & AddTagReq = ctx.request.body

  if (!id || !name) throw new Error('参数不正确')
  try {
    await tag.update({ where: { id }, data: { name, icon } })
    response.success(ctx)
  } catch (error) {
    response.success(ctx, null, '标签不存在或标签名称重复', 520)
  }
})

router.post(tagApi('/list'), async (ctx) => {
  const {
    name,
    current: skip,
    pageSize: take
  }: WithPaginationReq & AddTagReq = ctx.request.body

  if (!skip || !take) throw new Error('参数不正确')

  const where: Prisma.TagWhereInput = {
    name: {
      contains: name
    }
  }
  const total = await tag.count({ where })
  const list = await tag.findMany({
    take,
    where,
    skip: (skip - 1) * take
  })
  response.success(ctx, withList(list, total))
})

router.post(tagApi('/all'), async (ctx) => {
  const list = await tag.findMany()

  response.success(ctx, withList(list, list.length))
})

// 在客户端做筛选
// 全平台tag及其浏览量
router.post(tagApi('/view/platform'), async (ctx) => {
  const list = await tag.findMany({
    include: {
      articles: {
        select: {
          tagId: true
        }
      }
    }
  })
  const newList = list
    .map(({ articles, ...rest }) => ({
      ...rest,
      articleCount: articles.length
    }))
    .filter(({ articleCount }) => articleCount > 0)
  response.success(ctx, withList(newList, newList.length))
})

// 在客户端做筛选
// 用户tag(个性化查询)
router.post(tagApi('/view/personal'), async (ctx) => {
  const { authorId } = ctx.request.body

  if (!authorId) throw new Error('参数不正确')

  const list = await tag.findMany({
    where: {
      articles: {
        some: {
          authorId
        }
      }
    },
    include: {
      articles: {
        where: {
          authorId
        },
        include: {
          article: {
            select: {
              viewCount: true
            }
          }
        }
      }
    }
  })
  const newList = list.map(({ articles, ...rest }) => ({
    ...rest,
    articleCount: articles.length,
    viewCount: articles.reduce(
      (acc, { article: { viewCount } }) => acc + viewCount,
      0
    )
  }))
  response.success(ctx, withList(newList, newList.length))
})
