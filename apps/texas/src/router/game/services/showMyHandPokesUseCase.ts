import type { Poke } from 'texas-poker-core'
import type { ApiResult } from '../../../utils/apiResult'

import prisma from '../../../models'
import { GameWsGateway } from './gameWsGateway'
import { gameRuntimeRegistry } from './runtimeRegistry'
import { HTTP_STATUS } from '../../../constants/httpStatus'

export type ShowMyHandPokesData = {
  /** 第二次及以后请求为 true，不再次广播 WS */
  alreadyShown: boolean
}

function parseHandPokesJson(raw: unknown): Poke[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((x): x is Poke => typeof x === 'string') as Poke[]
}

/**
 * 局间主动亮牌：校验房间/对局/成员，写 `voluntaryShowHandAt` 幂等，首次向 /game 广播。
 *
 * **可亮牌**：
 * - 本手唯一未弃牌（收池）玩家——`game-end` 对他人掩码赢家底牌时可补信息；
 * - 本手已弃牌玩家——自愿公开自己底牌（`PlayerMatchRecord.isFold`，与 `onGameEnd` 落库一致）。
 *
 * **判定**：独收池依赖 Texas 局间内存态；弃牌路径以 DB `isFold` 为准（与引擎 `out` 在结算时一致）。无运行时 **409**，不放宽 matchId/控制器校验。
 */
export class ShowMyHandPokesUseCase {
  constructor(private readonly wsGateway: GameWsGateway) {}

  async execute(input: {
    userId: number
    roomId: number
    matchId: number
  }): Promise<ApiResult<ShowMyHandPokesData>> {
    const { userId, roomId, matchId } = input

    const membership = await prisma.roomMember.findFirst({
      where: { userId, roomId, room: { deletedAt: null } },
      select: { id: true }
    })
    if (!membership) {
      return {
        ok: false,
        status: HTTP_STATUS.FORBIDDEN,
        message: '不在该房间中'
      }
    }

    const roomRow = await prisma.room.findFirst({
      where: { id: roomId, deletedAt: null },
      select: { id: true, gameStatus: true }
    })
    if (!roomRow) {
      return { ok: false, status: HTTP_STATUS.NOT_FOUND, message: '房间不存在' }
    }
    if (roomRow.gameStatus !== 'between_hands') {
      return {
        ok: false,
        status: HTTP_STATUS.CONFLICT,
        message: '仅局间（between_hands）可亮牌'
      }
    }

    const matchRow = await prisma.match.findFirst({
      where: {
        id: matchId,
        roomId,
        endedAt: { not: null }
      },
      select: { id: true }
    })
    if (!matchRow) {
      return {
        ok: false,
        status: HTTP_STATUS.NOT_FOUND,
        message: '对局不存在、未结束或不属于该房间'
      }
    }

    const roomKey = String(roomId)
    const texas = gameRuntimeRegistry.getTexas(roomKey)
    const runtimeMatchId = gameRuntimeRegistry.getCurrentMatchId(roomKey)
    const controllerIdle =
      texas != null &&
      (texas.controller.status === 'idle' ||
        texas?.controller.status === 'hand_complete')
    if (texas == null || runtimeMatchId !== matchId || !controllerIdle) {
      return {
        ok: false,
        status: HTTP_STATUS.CONFLICT,
        message:
          '对局运行时不可用，或 matchId 与当前已结束的这一手不一致，暂无法亮牌'
      }
    }

    const selfPlayer = texas.room.getPlayerById(userId)
    if (!selfPlayer) {
      return {
        ok: false,
        status: HTTP_STATUS.FORBIDDEN,
        message: '不在本桌，无法亮牌'
      }
    }

    const record = await prisma.playerMatchRecord.findUnique({
      where: {
        matchId_userId: { matchId, userId }
      },
      select: {
        handPokes: true,
        voluntaryShowHandAt: true,
        isFold: true
      }
    })
    if (!record) {
      return {
        ok: false,
        status: HTTP_STATUS.NOT_FOUND,
        message: '未找到本手玩家记录'
      }
    }

    const remaining = texas.room
      .getPlayersBySeatStatus('on-set')
      .filter((p) => p.getStatus() !== 'out')

    const isSoleUnfoldedWinner =
      remaining.length === 1 && remaining[0].getUserInfo().id === userId
    const isFoldVoluntaryReveal = record.isFold === true

    if (!isSoleUnfoldedWinner && !isFoldVoluntaryReveal) {
      if (remaining.length === 1) {
        return {
          ok: false,
          status: HTTP_STATUS.FORBIDDEN,
          message: '仅本手收池玩家或已弃牌玩家本人可亮牌'
        }
      }
      return {
        ok: false,
        status: HTTP_STATUS.CONFLICT,
        message: '当前对局已摊牌或存在多名未弃牌玩家，不满足主动亮牌条件'
      }
    }

    if (record.voluntaryShowHandAt != null) {
      return { ok: true, data: { alreadyShown: true } }
    }

    const handPokes = parseHandPokesJson(record.handPokes)

    const claimed = await prisma.playerMatchRecord.updateMany({
      where: {
        matchId,
        userId,
        voluntaryShowHandAt: null
      },
      data: { voluntaryShowHandAt: new Date() }
    })

    if (claimed.count === 0) {
      return { ok: true, data: { alreadyShown: true } }
    }

    this.wsGateway.notifyPlayerHandVoluntarilyShown(roomKey, {
      userId,
      handPokes
    })

    return { ok: true, data: { alreadyShown: false } }
  }
}
