import type { ParameterizedContext } from 'koa'

import response from '../utils/response'
import { type DefaultState } from './instance'
import { user, playerMatchRecord } from '../models'
import { HTTP_STATUS } from '../constants/httpStatus'

export type WebKoaCtx = ParameterizedContext<DefaultState>

export async function assertWebUser(ctx: WebKoaCtx): Promise<number | null> {
  const userId = ctx.state.user?.id
  if (!userId) {
    response.error(ctx, HTTP_STATUS.UNAUTHORIZED, '身份凭证无效, 请重新登陆')
    return null
  }
  return userId
}

export async function assertWebAdmin(ctx: WebKoaCtx): Promise<number | null> {
  const userId = await assertWebUser(ctx)
  if (userId == null) return null

  const login = await user.findUnique({
    where: { id: userId },
    select: { isAdmin: true }
  })
  if (!login?.isAdmin) {
    response.error(ctx, HTTP_STATUS.FORBIDDEN, '无权限')
    return null
  }
  return userId
}

/** 管理员或本局参与者可查看对局敏感数据（错误、原始记录等） */
export async function assertMatchSensitiveAccess(
  ctx: WebKoaCtx,
  matchId: number
): Promise<{ userId: number; isAdmin: boolean } | null> {
  const userId = await assertWebUser(ctx)
  if (userId == null) return null

  const loginUser = await user.findUnique({
    where: { id: userId },
    select: { isAdmin: true }
  })
  if (!loginUser) {
    response.error(ctx, HTTP_STATUS.NOT_FOUND, '用户不存在')
    return null
  }
  if (loginUser.isAdmin) {
    return { userId, isAdmin: true }
  }
  const participated = await playerMatchRecord.findUnique({
    where: { matchId_userId: { matchId, userId } }
  })
  if (!participated) {
    response.error(ctx, HTTP_STATUS.FORBIDDEN, '无权限查看该对局')
    return null
  }
  return { userId, isAdmin: false }
}
