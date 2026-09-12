import router from '../instance'
import { apiPrefix } from '../../config'
import combinePath from '../../utils/combinePath'
import { respondFromApiResult } from '../../utils/respondFromApiResult'
import {
  getRoadSignFacade,
  listRoadSignsFacade,
  createRoadSignFacade,
  deleteRoadSignFacade,
  updateRoadSignFacade
} from './services/roadsignFacade'

const roadsignApi = combinePath(apiPrefix)('/roadsign')

router.get(roadsignApi('/list'), async (ctx) => {
  const result = await listRoadSignsFacade(ctx.query as Record<string, unknown>)
  respondFromApiResult(ctx, result)
})

router.get(roadsignApi('/detail'), async (ctx) => {
  const result = await getRoadSignFacade(ctx.query.id)
  respondFromApiResult(ctx, result)
})

router.post(roadsignApi('/create'), async (ctx) => {
  const body = (ctx.request.body || {}) as Record<string, unknown>
  const result = await createRoadSignFacade(body)
  respondFromApiResult(ctx, result, { okMessage: '创建成功' })
})

router.post(roadsignApi('/update'), async (ctx) => {
  const body = (ctx.request.body || {}) as Record<string, unknown>
  const result = await updateRoadSignFacade(body)
  respondFromApiResult(ctx, result, { okMessage: '更新成功' })
})

router.post(roadsignApi('/delete'), async (ctx) => {
  const body = (ctx.request.body || {}) as { id?: unknown }
  const result = await deleteRoadSignFacade(body.id ?? ctx.query.id)
  respondFromApiResult(ctx, result, { okMessage: '删除成功' })
})
