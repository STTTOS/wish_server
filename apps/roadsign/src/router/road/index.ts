import router from '../instance'
import { apiPrefix } from '../../config'
import combinePath from '../../utils/combinePath'
import { respondFromApiResult } from '../../utils/respondFromApiResult'
import {
  listRoadsFacade,
  createRoadFacade,
  deleteRoadFacade,
  updateRoadFacade
} from './services/roadFacade'

const roadApi = combinePath(apiPrefix)('/road')

router.get(roadApi('/list'), async (ctx) => {
  const result = await listRoadsFacade()
  respondFromApiResult(ctx, result)
})

router.post(roadApi('/create'), async (ctx) => {
  const body = (ctx.request.body || {}) as Record<string, unknown>
  const result = await createRoadFacade(body)
  respondFromApiResult(ctx, result, { okMessage: '创建成功' })
})

router.post(roadApi('/update'), async (ctx) => {
  const body = (ctx.request.body || {}) as Record<string, unknown>
  const result = await updateRoadFacade(body)
  respondFromApiResult(ctx, result, { okMessage: '更新成功' })
})

router.post(roadApi('/delete'), async (ctx) => {
  const body = (ctx.request.body || {}) as { id?: unknown }
  const result = await deleteRoadFacade(body.id ?? ctx.query.id)
  respondFromApiResult(ctx, result, { okMessage: '删除成功' })
})
