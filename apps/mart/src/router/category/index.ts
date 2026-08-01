import router from '../instance'
import { apiPrefix } from '../../config'
import combinePath from '../../utils/combinePath'
import { respondFromApiResult } from '../../utils/respondFromApiResult'
import {
  createCategoryFacade,
  deleteCategoryFacade,
  listCategoriesFacade,
  updateCategoryFacade
} from './services/categoryFacade'

const categoryApi = combinePath(apiPrefix)('/category')

router.get(categoryApi('/list'), async (ctx) => {
  const result = await listCategoriesFacade()
  respondFromApiResult(ctx, result)
})

router.post(categoryApi('/create'), async (ctx) => {
  const body = (ctx.request.body || {}) as { name?: unknown }
  const result = await createCategoryFacade({ name: body.name })
  respondFromApiResult(ctx, result, { okMessage: '创建成功' })
})

router.post(categoryApi('/update'), async (ctx) => {
  const body = (ctx.request.body || {}) as { id?: unknown; name?: unknown }
  const result = await updateCategoryFacade({ id: body.id, name: body.name })
  respondFromApiResult(ctx, result, { okMessage: '更新成功' })
})

router.post(categoryApi('/delete'), async (ctx) => {
  const body = (ctx.request.body || {}) as { id?: unknown }
  const result = await deleteCategoryFacade({ id: body.id })
  respondFromApiResult(ctx, result, { okMessage: '删除成功' })
})
