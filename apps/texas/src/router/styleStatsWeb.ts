/**
 * Web 公开：牌风技术分排行（首页 / 全站榜）
 */
import router from './instance'
import { apiPrefixWeb } from '../config'
import response from '../utils/response'
import combinePath from '../utils/combinePath'
import { STYLE_SCOPE_ALL } from '../styleStats/engine'
import { getSkillLeaders } from '../styleStats/getSkillLeaders'

const styleStatsWebApi = combinePath(apiPrefixWeb)('/style-stats')

router.post(styleStatsWebApi('/skill-leaders'), async (ctx) => {
  const body = (ctx.request.body ?? {}) as { limit?: number; scope?: string }
  const limit = typeof body.limit === 'number' ? body.limit : 3
  const scope =
    typeof body.scope === 'string' && body.scope.trim()
      ? body.scope.trim()
      : STYLE_SCOPE_ALL

  const { list, total } = await getSkillLeaders(limit, scope)
  response.success(ctx, { list, total, scope })
})
