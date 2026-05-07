import dayjs from 'dayjs'

import router from '../instance'
import response from '../../utils/response'
import { announcement } from '../../models'
import { assertWebAdmin } from '../webAuth'
import combinePath from '../../utils/combinePath'
import { HTTP_STATUS } from '../../constants/httpStatus'
import { isValidSemverCoreString } from '../../utils/semverCompare'
import { timeFormat, apiPrefixWeb, apiPrefixClient } from '../../config'
import {
  isMaintenanceEnabled,
  setMaintenanceEnabled
} from '../../utils/maintenanceSwitch'
import {
  getMinClientAppVersion,
  setMinClientAppVersion
} from '../../utils/clientMinVersionPolicy'

const systemApiWeb = combinePath(apiPrefixWeb)('/system')
const systemApiClient = combinePath(apiPrefixClient)('/system')

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

// 客户端：查询维护开关状态
router.post(systemApiClient('/maintenance/status'), async (ctx) => {
  const enabled = await isMaintenanceEnabled()
  response.success(ctx, { enabled }, '查询成功')
})

// 客户端：获取当前维护公告（仅返回一条，按 priority desc、publishAt desc）
router.post(systemApiClient('/maintenanceNotice'), async (ctx) => {
  const now = new Date()
  const item = await announcement.findFirst({
    where: {
      deletedAt: null,
      type: 'maintenance',
      status: 'published',
      publishAt: { lte: now },
      OR: [{ expireAt: null }, { expireAt: { gte: now } }]
    },
    orderBy: [{ priority: 'desc' }, { publishAt: 'desc' }],
    select: {
      id: true,
      type: true,
      title: true,
      summary: true,
      content: true,
      actionText: true,
      actionUrl: true,
      priority: true,
      publishAt: true,
      expireAt: true,
      updatedAt: true
    }
  })

  if (!item) {
    response.success(ctx, null, '查询成功')
    return
  }

  response.success(
    ctx,
    {
      ...item,
      publishAt: dayjs(item.publishAt).format(timeFormat),
      expireAt: item.expireAt ? dayjs(item.expireAt).format(timeFormat) : null,
      updatedAt: dayjs(item.updatedAt).format(timeFormat)
    },
    '查询成功'
  )
})

// 后台：设置维护开关（管理员）
router.post(systemApiWeb('/maintenance/set'), async (ctx) => {
  const { enabled: rawEnabled } = (ctx.request.body ?? {}) as {
    enabled?: unknown
  }
  const enabled = parseEnabled(rawEnabled)
  if (enabled == null) {
    response.error(
      ctx,
      HTTP_STATUS.BAD_REQUEST,
      '参数异常：enabled 必须为 true/false 或 1/0'
    )
    return
  }

  const ok = await setMaintenanceEnabled(enabled)
  if (!ok) {
    response.error(ctx, HTTP_STATUS.INTERNAL_SERVER_ERROR, '维护开关设置失败')
    return
  }

  response.success(ctx, { enabled }, enabled ? '维护已开启' : '维护已关闭')
})

// 后台：查询客户端最低 App 版本（管理员）
router.post(systemApiWeb('/client-version/detail'), async (ctx) => {
  if ((await assertWebAdmin(ctx)) == null) return
  const minVersion = await getMinClientAppVersion()
  response.success(
    ctx,
    {
      minVersion,
      hint: '与 Expo app.json 中 expo.version 对齐；低于此版本的 App 调用 /api/client/* 将返回 403'
    },
    '查询成功'
  )
})

// 后台：设置客户端最低 App 版本（管理员）
router.post(systemApiWeb('/client-version/set'), async (ctx) => {
  if ((await assertWebAdmin(ctx)) == null) return
  const { minVersion: raw } = (ctx.request.body ?? {}) as {
    minVersion?: unknown
  }
  if (typeof raw !== 'string' || !raw.trim()) {
    response.error(
      ctx,
      HTTP_STATUS.BAD_REQUEST,
      '参数异常：需要字符串 minVersion'
    )
    return
  }
  const minVersion = raw.trim()
  if (!isValidSemverCoreString(minVersion)) {
    response.error(
      ctx,
      HTTP_STATUS.BAD_REQUEST,
      'minVersion 须为 semver 主版本号，如 1.0.0'
    )
    return
  }
  const ok = await setMinClientAppVersion(minVersion)
  if (!ok) {
    response.error(ctx, HTTP_STATUS.INTERNAL_SERVER_ERROR, '最低版本写入失败')
    return
  }
  response.success(ctx, { minVersion }, '已更新最低客户端版本')
})
