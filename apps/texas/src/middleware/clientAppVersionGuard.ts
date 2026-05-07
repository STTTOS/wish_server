import type { ParameterizedContext } from 'koa'

import response from '../utils/response'
import { DefaultState } from '../router/instance'
import { HTTP_STATUS } from '../constants/httpStatus'
import { getMinClientAppVersion } from '../utils/clientMinVersionPolicy'
import { parseSemverCore, compareSemverCore } from '../utils/semverCompare'
import {
  APP_VERSION_TOO_LOW_DETAILS_TYPE,
  CLIENT_VERSION_CHECK_WHITELIST_PATHS
} from '../constants/clientVersionConstants'

const whitelist = new Set<string>(CLIENT_VERSION_CHECK_WHITELIST_PATHS)

/** 与版本低于 min 时一致，便于老包（未带 version）走同一套客户端提示 */
const CLIENT_VERSION_TOO_LOW_MESSAGE =
  '当前应用版本过低, 为了正常游戏体验, 需要更新到最新版本'

function readClientVersion(ctx: ParameterizedContext<DefaultState>): unknown {
  const method = ctx.method.toUpperCase()
  if (method === 'GET') {
    return ctx.query.version
  }
  const body = ctx.request.body
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    return (body as Record<string, unknown>).version
  }
  return undefined
}

export default async function clientAppVersionGuard(
  ctx: ParameterizedContext<DefaultState>,
  next: () => Promise<void>
) {
  const path = ctx.path
  if (!path.startsWith('/api/client/')) {
    await next()
    return
  }
  if (whitelist.has(path)) {
    await next()
    return
  }

  const raw = readClientVersion(ctx)
  let explicitVersion: string | undefined
  if (typeof raw === 'string' && raw.trim() !== '') {
    explicitVersion = raw.trim()
  } else if (typeof raw === 'number' && Number.isFinite(raw)) {
    explicitVersion = String(raw)
  }

  if (explicitVersion != null && parseSemverCore(explicitVersion) == null) {
    response.error(
      ctx,
      HTTP_STATUS.BAD_REQUEST,
      'version 格式无效，须为 semver 如 1.0.0'
    )
    return
  }

  const minVersion = await getMinClientAppVersion()
  if (parseSemverCore(minVersion) == null) {
    await next()
    return
  }

  /** 未携带 version 的老包按 0.0.0 参与比较：min 为 0.0.0 时仍放行，min 提高后与「版本过低」同一提示 */
  const effectiveVersion = explicitVersion ?? '0.0.0'
  const cmp = compareSemverCore(effectiveVersion, minVersion)
  if (cmp == null) {
    await next()
    return
  }
  if (cmp < 0) {
    response.error(ctx, HTTP_STATUS.FORBIDDEN, CLIENT_VERSION_TOO_LOW_MESSAGE, {
      type: APP_VERSION_TOO_LOW_DETAILS_TYPE,
      minVersion
    })
    return
  }

  await next()
}
