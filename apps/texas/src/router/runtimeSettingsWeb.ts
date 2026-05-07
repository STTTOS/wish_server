/**
 * Web 管理端：游戏进程内运行时参数（与 `POST /api/client/game/setRuntimeConfig` 同源）。
 */
import router from './instance'
import response from '../utils/response'
import { apiPrefixWeb } from '../config'
import { assertWebAdmin } from './webAuth'
import combinePath from '../utils/combinePath'
import { HTTP_STATUS } from '../constants/httpStatus'
import { runtimeConfigFieldDefinitions } from '../utils/gameRuntimeConfigMeta'
import {
  gameRuntimeConfig,
  type GameRuntimeConfigPatch
} from '../utils/gameRuntimeConfig'

const base = combinePath(apiPrefixWeb)('/system/runtime-settings')

router.post(base('/detail'), async (ctx) => {
  if ((await assertWebAdmin(ctx)) == null) return
  response.success(
    ctx,
    {
      snapshot: gameRuntimeConfig.getFullSnapshot(),
      fields: runtimeConfigFieldDefinitions
    },
    'ok'
  )
})

router.post(base('/update'), async (ctx) => {
  if ((await assertWebAdmin(ctx)) == null) return
  const body = (ctx.request.body ?? {}) as GameRuntimeConfigPatch
  const result = gameRuntimeConfig.applyPatch(body)
  if (!result.ok) {
    response.error(ctx, HTTP_STATUS.BAD_REQUEST, result.message)
    return
  }
  response.success(ctx, result.data, '已更新')
})
