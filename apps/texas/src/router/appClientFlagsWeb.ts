/**
 * Web 管理端：App 客户端展示开关（主页积分榜等）
 */
import router from './instance'
import response from '../utils/response'
import { apiPrefixWeb } from '../config'
import { assertWebAdmin } from './webAuth'
import combinePath from '../utils/combinePath'
import { HTTP_STATUS } from '../constants/httpStatus'
import {
  appClientFlags,
  type AppClientFlagsPatch
} from '../utils/appClientFlags'

const base = combinePath(apiPrefixWeb)('/system/app-client-flags')

router.post(base('/detail'), async (ctx) => {
  if ((await assertWebAdmin(ctx)) == null) return
  response.success(
    ctx,
    {
      snapshot: appClientFlags.getSnapshot(),
      fields: [
        {
          key: 'showHomeScoreLeaders',
          label: 'App 主页积分榜',
          description:
            '关闭后 App 大厅不再展示积分榜 TOP3；默认开启。进程内配置，重启后恢复默认。'
        }
      ]
    },
    'ok'
  )
})

router.post(base('/update'), async (ctx) => {
  if ((await assertWebAdmin(ctx)) == null) return
  const body = (ctx.request.body ?? {}) as AppClientFlagsPatch
  const result = appClientFlags.applyPatch(body)
  if (!result.ok) {
    response.error(ctx, HTTP_STATUS.BAD_REQUEST, result.message)
    return
  }
  response.success(ctx, result.data, '已更新')
})
