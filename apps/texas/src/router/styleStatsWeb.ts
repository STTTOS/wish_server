/**
 * Web 公开：积分榜 / 纪律榜（首页 · 全站榜）
 */
import router from './instance'
import { apiPrefixWeb } from '../config'
import response from '../utils/response'
import combinePath from '../utils/combinePath'
import { STYLE_SCOPE_ALL } from '../styleStats/engine'
import { getScoreLeaders } from '../styleStats/getScoreLeaders'
import { getDisciplineLeaders } from '../styleStats/getDisciplineLeaders'

const styleStatsWebApi = combinePath(apiPrefixWeb)('/style-stats')

router.post(styleStatsWebApi('/score-leaders'), async (ctx) => {
  const body = (ctx.request.body ?? {}) as { limit?: number; scope?: string }
  const limit = typeof body.limit === 'number' ? body.limit : 3
  const scope =
    typeof body.scope === 'string' && body.scope.trim()
      ? body.scope.trim()
      : STYLE_SCOPE_ALL

  const { list, total } = await getScoreLeaders(limit, scope)
  response.success(ctx, { list, total, scope })
})

router.post(styleStatsWebApi('/discipline-leaders'), async (ctx) => {
  const body = (ctx.request.body ?? {}) as { limit?: number; scope?: string }
  const limit = typeof body.limit === 'number' ? body.limit : 3
  const scope =
    typeof body.scope === 'string' && body.scope.trim()
      ? body.scope.trim()
      : STYLE_SCOPE_ALL

  const { list, total } = await getDisciplineLeaders(limit, scope)
  response.success(ctx, { list, total, scope })
})
