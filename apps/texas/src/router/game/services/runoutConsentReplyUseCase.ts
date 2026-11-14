import type { ApiVoidResult } from '../../../utils/apiResult'

import { roomMember } from '../../../models'
import { gameRuntimeRegistry } from './runtimeRegistry'
import { HTTP_STATUS } from '../../../constants/httpStatus'
import { recordRunoutConsentVote } from './texasDomain/runoutConsentSession'

type Input = {
  userId: number
  roomId: number
  matchId: number
  agree: boolean
}

/**
 * all-in 玩家回复是否同意二次跑马。
 * 进度广播由 session.notifyVote（drain 注入）完成，此处不重复推送。
 */
export class RunoutConsentReplyUseCase {
  async execute(input: Input): Promise<ApiVoidResult> {
    const { userId, roomId, matchId, agree } = input
    if (!Number.isFinite(roomId) || !Number.isFinite(matchId)) {
      return { ok: false, status: HTTP_STATUS.BAD_REQUEST, message: '参数异常' }
    }
    if (typeof agree !== 'boolean') {
      return { ok: false, status: HTTP_STATUS.BAD_REQUEST, message: '参数异常' }
    }

    const membership = await roomMember.findFirst({
      where: { userId, roomId, room: { deletedAt: null } },
      select: { roomId: true }
    })
    if (!membership) {
      return {
        ok: false,
        status: HTTP_STATUS.CONFLICT,
        message: '当前不在对局房间中'
      }
    }

    const roomKey = String(roomId)
    const texas = gameRuntimeRegistry.getTexas(roomKey)
    if (!texas) {
      return { ok: false, status: HTTP_STATUS.NOT_FOUND, message: '对局不存在' }
    }
    const currentMatchId = gameRuntimeRegistry.getCurrentMatchId(roomKey)
    if (currentMatchId !== matchId) {
      return {
        ok: false,
        status: HTTP_STATUS.CONFLICT,
        message: '对局已更新'
      }
    }

    const result = recordRunoutConsentVote(roomKey, roomId, userId, agree)
    if (!result.ok) {
      return {
        ok: false,
        status: HTTP_STATUS.CONFLICT,
        message: result.message
      }
    }
    return { ok: true, data: null }
  }
}
