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
 * **何时有意义**：仅「一人收池、其余均已弃牌」——恰好一名未弃牌玩家且为当前用户；`game-end` 对他人会掩码该赢家底牌时才有信息增量。
 *
 * **判定方式**：依赖 Texas 内存态——`onGameEnd` 只 `controller.reset()`，局间 `on-set` 且非 `out` 人数与结算时 `isFold` 一致。
 * **无运行时**（进程重启、运行时已销毁等）：直接 **409**，不查库兜底；亮牌条件与引擎一致，缺运行时无法保证与当前桌状态同步。
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

    const remaining = texas.room
      .getPlayersBySeatStatus('on-set')
      .filter((p) => p.getStatus() !== 'out')
    if (remaining.length !== 1) {
      return {
        ok: false,
        status: HTTP_STATUS.CONFLICT,
        message: '当前对局已摊牌或存在多名未弃牌玩家，无需亮牌'
      }
    }
    if (remaining[0].getUserInfo().id !== userId) {
      return {
        ok: false,
        status: HTTP_STATUS.FORBIDDEN,
        message: '仅本手未弃牌的玩家可亮牌'
      }
    }

    const record = await prisma.playerMatchRecord.findUnique({
      where: {
        matchId_userId: { matchId, userId }
      },
      select: {
        handPokes: true,
        voluntaryShowHandAt: true
      }
    })
    if (!record) {
      return {
        ok: false,
        status: HTTP_STATUS.NOT_FOUND,
        message: '未找到本手玩家记录'
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
