import router from '../instance'
import response from '../../utils/response'
import { apiPrefixWeb } from '../../config'
import combinePath from '../../utils/combinePath'
import {
  isMaintenanceEnabled,
  setMaintenanceEnabled
} from '../../utils/maintenanceSwitch'

const systemApiWeb = combinePath(apiPrefixWeb)('/system')

const parseEnabled = (value: unknown): boolean | null => {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (value === 1) return true
    if (value === 0) return false
    return null
  }
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase()
    if (v === '1' || v === 'true' || v === 'on') return true
    if (v === '0' || v === 'false' || v === 'off') return false
  }
  return null
}

// 后台：查询维护开关状态（管理员）
router.post(systemApiWeb('/maintenance/status'), async (ctx) => {
  const enabled = await isMaintenanceEnabled()
  response.success(ctx, { enabled }, '查询成功')
})

// 后台：设置维护开关（管理员）
router.post(systemApiWeb('/maintenance/set'), async (ctx) => {
  const { enabled: rawEnabled } = (ctx.request.body ?? {}) as {
    enabled?: unknown
  }
  const enabled = parseEnabled(rawEnabled)
  if (enabled == null) {
    response.error(ctx, 400, '参数异常：enabled 必须为 true/false 或 1/0')
    return
  }

  const ok = await setMaintenanceEnabled(enabled)
  if (!ok) {
    response.error(ctx, 2000, '维护开关设置失败')
    return
  }

  response.success(ctx, { enabled }, enabled ? '维护已开启' : '维护已关闭')
})
