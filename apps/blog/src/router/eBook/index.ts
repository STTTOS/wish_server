import type { Identity } from '../interface'
import type { EBookLookUpList } from './interface'

import moment from 'moment'
import { Prisma } from '@prisma/blog-client'

import router from '../instance'
import { eBook } from '../../models'
import response from '../../utils/response'
import { parseUserInfoByCookie } from '../user'
import { withList } from '../../utils/response'
import combinePath from '../../utils/combinePath'
import { apiPrefix, timeFormat } from '../../config'

const eBookApi = combinePath(apiPrefix)('/ebook')

router.post(eBookApi('/add'), async (ctx) => {
  const { cookie = '' } = ctx.request.header
  const { name, category, words, eBookUrl }: Prisma.EBookCreateInput =
    ctx.request.body

  const { id: userId } = (await parseUserInfoByCookie(cookie)) || {}

  await eBook.create({ data: { name, category, eBookUrl, words, userId } })
  response.success(ctx)
})

router.post(eBookApi('/update'), async (ctx) => {
  const { cookie = '' } = ctx.request.header
  const {
    name,
    category,
    words,
    eBookUrl,
    id
  }: Prisma.EBookUncheckedCreateInput = ctx.request.body

  if (!id) throw new Error('id 不能为空')

  const { id: userId } = (await parseUserInfoByCookie(cookie)) || {}
  try {
    await eBook.update({
      data: { name, category, eBookUrl, words, userId },
      where: { id }
    })
    response.success(ctx)
  } catch (error) {
    response.success(ctx, null, '电子书不存在')
  }
})

router.post(eBookApi('/delete'), async (ctx) => {
  const { id }: Identity = ctx.request.body

  if (!id) throw new Error('id 不能为空')

  try {
    await eBook.delete({ where: { id } })
    response.success(ctx)
  } catch (error) {
    response.error(ctx, 500, '删除失败')
  }
})

router.post(eBookApi('/list'), async (ctx) => {
  const { name, category, pageSize, current }: EBookLookUpList =
    ctx.request.body

  if (!current || !pageSize) throw new Error('分页参数不正确')

  const where: Prisma.EBookWhereInput = {}

  if (name) {
    where.name = { contains: name }
  }
  if (category && category.length > 0) {
    where.category = { in: category }
  }
  const total = await eBook.count({ where })
  const list = await eBook.findMany({
    where,
    take: pageSize,
    skip: (current - 1) * pageSize,
    include: {
      user: true
    }
  })

  // 格式化时间
  const newList = list.map(({ createdAt, user, ...rest }) => ({
    ...rest,
    createdBy: user?.name || user?.username,
    createdAt: moment(createdAt).format(timeFormat)
  }))
  response.success(ctx, withList(newList, total))
})
