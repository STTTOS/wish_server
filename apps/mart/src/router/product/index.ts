import router from '../instance'
import { apiPrefix } from '../../config'
import combinePath from '../../utils/combinePath'
import { respondFromApiResult } from '../../utils/respondFromApiResult'
import {
  getProductFacade,
  listProductsFacade,
  createProductFacade,
  deleteProductFacade,
  updateProductFacade
} from './services/productFacade'

const productApi = combinePath(apiPrefix)('/product')

router.get(productApi('/list'), async (ctx) => {
  const query = ctx.query as {
    keyword?: unknown
    categoryId?: unknown
    page?: unknown
    pageSize?: unknown
    sortBy?: unknown
    sortOrder?: unknown
  }
  const result = await listProductsFacade({
    role: ctx.state.user!.role,
    keyword: query.keyword,
    categoryId: query.categoryId,
    page: query.page,
    pageSize: query.pageSize,
    sortBy: query.sortBy,
    sortOrder: query.sortOrder
  })
  respondFromApiResult(ctx, result)
})

router.get(productApi('/detail'), async (ctx) => {
  const idRaw = ctx.query.id
  const id =
    typeof idRaw === 'string' ? Number(idRaw) : (idRaw as unknown as number)
  const result = await getProductFacade({
    role: ctx.state.user!.role,
    id
  })
  respondFromApiResult(ctx, result)
})

router.post(productApi('/create'), async (ctx) => {
  const body = (ctx.request.body || {}) as Record<string, unknown>
  const result = await createProductFacade({
    role: ctx.state.user!.role,
    body
  })
  respondFromApiResult(ctx, result, { okMessage: '创建成功' })
})

router.post(productApi('/update'), async (ctx) => {
  const body = (ctx.request.body || {}) as Record<string, unknown>
  const result = await updateProductFacade({
    role: ctx.state.user!.role,
    body
  })
  respondFromApiResult(ctx, result, { okMessage: '更新成功' })
})

router.post(productApi('/delete'), async (ctx) => {
  const body = (ctx.request.body || {}) as { id?: unknown }
  const result = await deleteProductFacade({ id: body.id })
  respondFromApiResult(ctx, result, { okMessage: '删除成功' })
})
