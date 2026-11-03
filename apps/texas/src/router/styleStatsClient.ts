/**
 * App 客户端：积分榜（仅正分）
 */
import router from './instance'
import response from '../utils/response'
import { apiPrefixClient } from '../config'
import combinePath from '../utils/combinePath'
import { STYLE_SCOPE_ALL } from '../styleStats/engine'
import { getScoreLeaders } from '../styleStats/getScoreLeaders'

const styleStatsClientApi = combinePath(apiPrefixClient)('/style-stats')

/**
 * body: { limit?: number, scope?: string }
 * 固定 positiveOnly：负分不入榜。
 */
router.post(styleStatsClientApi('/score-leaders'), async (ctx) => {
  const body = (ctx.request.body ?? {}) as { limit?: number; scope?: string }
  const limit = typeof body.limit === 'number' ? body.limit : 3
  const scope =
    typeof body.scope === 'string' && body.scope.trim()
      ? body.scope.trim()
      : STYLE_SCOPE_ALL

  const { list, total } = await getScoreLeaders({
    limit,
    scope,
    positiveOnly: true
  })
  response.success(ctx, { list, total, scope })
})
