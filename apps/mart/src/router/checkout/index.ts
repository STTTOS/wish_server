import router from '../instance'
import { apiPrefix } from '../../config'
import combinePath from '../../utils/combinePath'
import { checkoutFacade } from './services/checkoutFacade'
import { respondFromApiResult } from '../../utils/respondFromApiResult'

const checkoutApi = combinePath(apiPrefix)('/checkout')

/**
 * POST /api/checkout
 * Body: { items: [{ productId, quantity }] }
 *
 * 需登录；admin / staff 均可。不在 ADMIN_ONLY_PATHS 中。
 */
router.post(checkoutApi(''), async (ctx) => {
  const body = (ctx.request.body || {}) as Record<string, unknown>
  const result = await checkoutFacade({ body })
  respondFromApiResult(ctx, result, { okMessage: '结账成功' })
})
