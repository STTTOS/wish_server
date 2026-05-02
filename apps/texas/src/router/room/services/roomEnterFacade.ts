import type { ApiResult } from '../../../utils/apiResult'
import type { RoomGameStatus } from '@prisma/texas-client'

import prisma from '../../../models'
import { RoomJoinFacade } from './roomJoinFacade'
import { HTTP_STATUS } from '../../../constants/httpStatus'
import { JoinGameUseCase } from '../../game/services/joinGameUseCase'
import { gameRuntimeRegistry } from '../../game/services/runtimeRegistry'
import { getCurrentMatchIdWithFallback } from '../../game/services/currentMatch'

/** `POST /room/enter` 成功体：与 `room/join`、`game/join` 语义对齐，便于客户端统一解析 */
export type RoomEnterSuccessData = {
  roomId: number
  gameStatus: RoomGameStatus
  joinedAs: 'waiting_room' | 'game_table'
  gameRuntimeAttached: boolean
  currentMatchId: number | null
}

export type RoomEnterResult = ApiResult<RoomEnterSuccessData>

/**
 * 薄门面：仅根据房间 `gameStatus` 分派 — `waiting` → {@link RoomJoinFacade}，否则 → {@link JoinGameUseCase}。
 * 入参与 `room/join` 相同（`roomCode`），无需客户端猜阶段。
 */
export class RoomEnterFacade {
  constructor(
    private readonly roomJoin: RoomJoinFacade,
    private readonly joinGame: JoinGameUseCase
  ) {}

  async execute(input: {
    roomCode?: string
    roomId?: number
    userId: number
  }): Promise<RoomEnterResult> {
    const normalizedRoomId =
      typeof input.roomId === 'number' &&
      Number.isFinite(input.roomId) &&
      input.roomId > 0
        ? Math.trunc(input.roomId)
        : null
    const rawCode = typeof input.roomCode === 'string' ? input.roomCode : ''
    const code = rawCode.trim().toUpperCase()

    if (normalizedRoomId == null && !code) {
      return {
        ok: false,
        status: HTTP_STATUS.BAD_REQUEST,
        message: '房间参数不能为空'
      }
    }

    const row = await prisma.room.findUnique({
      where:
        normalizedRoomId != null
          ? { id: normalizedRoomId }
          : { activeCode: code },
      select: { id: true, gameStatus: true, deletedAt: true, activeCode: true }
    })
    if (!row || row.deletedAt) {
      return {
        ok: false,
        status: HTTP_STATUS.NOT_FOUND,
        message: '房间不存在或房间代码错误'
      }
    }

    if (row.gameStatus === 'waiting') {
      const roomCodeForJoin = row.activeCode ?? code
      if (!roomCodeForJoin) {
        return {
          ok: false,
          status: HTTP_STATUS.CONFLICT,
          message: '等待房缺少有效房间代码，请刷新后重试'
        }
      }
      const r = await this.roomJoin.execute({
        roomCode: roomCodeForJoin,
        userId: input.userId
      })
      if (!r.ok) {
        return {
          ok: false,
          status: r.status,
          message: r.message,
          details: r.details
        }
      }
      return {
        ok: true,
        data: {
          roomId: r.data.roomId,
          gameStatus: r.data.gameStatus,
          joinedAs: r.data.joinedAs,
          gameRuntimeAttached: r.data.gameRuntimeAttached,
          currentMatchId: null
        }
      }
    }

    /**
     * 非 waiting：直接走 {@link JoinGameUseCase}（与 `POST /game/join` 一致）。
     * 尚无 `RoomMember` 时由用例内事务创建，**不得**在此处拦截，否则中途加入会误报 409。
     * 杀进程恢复：客户端应先调 `POST /room/resumeMembership`，非成员则勿调本接口，避免被踢用户误进。
     */
    const roomKey = String(row.id)
    const g = await this.joinGame.execute({
      roomId: row.id,
      userId: input.userId
    })
    if (!g.ok) {
      return {
        ok: false,
        status: g.status,
        message: g.message,
        details: g.details
      }
    }

    const currentMatchId = await getCurrentMatchIdWithFallback(row.id)

    return {
      ok: true,
      data: {
        roomId: row.id,
        gameStatus: row.gameStatus,
        joinedAs: 'game_table',
        gameRuntimeAttached: gameRuntimeRegistry.hasTexas(roomKey),
        currentMatchId
      }
    }
  }
}
