import type { RequestBody, WithPaginationReq } from '../interface'

import { Prisma } from '@prisma/client'

import router from '../instance'
import { tools } from '../../models'
import { apiPrefix } from '../../config'
import response from '../../utils/response'
import { withList } from '../../utils/response'
import combinePath from '../../utils/combinePath'

const toolsApi = combinePath(apiPrefix)('/tools')

router.post(toolsApi('/add'), async (ctx) => {
  const { title, scriptUrl, cssHref } = ctx.request.body

  await tools.create({ data: { title, scriptUrl, cssHref } })
  response.success(ctx)
})

router.post(toolsApi('/update'), async (ctx) => {
  const { id, title, scriptUrl, cssHref } = ctx.request.body

  if (!id) throw new Error('id 不能为空')

  try {
    await tools.update({ where: { id }, data: { title, scriptUrl, cssHref } })
    response.success(ctx)
  } catch (error) {
    response.success(ctx, null, '工具不存在或工具名称重复', 500)
  }
})

router.post(toolsApi('/delete'), async (ctx) => {
  const { id } = ctx.request.body

  if (!id) throw new Error('id 不能为空')

  try {
    await tools.delete({ where: { id: Number(id) } })
    response.success(ctx)
  } catch (error) {
    response.success(ctx, null, '工具不存在')
  }
})

router.post(toolsApi('/list'), async (ctx) => {
  const {
    pageSize: take,
    current: skip,
    title
  }: RequestBody & WithPaginationReq = ctx.request.body

  if (!skip || !take) throw new Error('参数不正确')

  const where: Prisma.ToolsWhereInput = {
    title: {
      contains: title
    }
  }
  const total = await tools.count({ where })
  const list = await tools.findMany({
    take,
    where,
    skip: (skip - 1) * take
  })
  response.success(ctx, withList(list, total))
})

router.post(toolsApi('/all'), async (ctx) => {
  const list = await tools.findMany()
  response.success(ctx, withList(list, list.length))
})
