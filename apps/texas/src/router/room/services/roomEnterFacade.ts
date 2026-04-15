import type { ApiResult } from '../../../utils/apiResult'
import type { RoomGameStatus } from '@prisma/texas-client'

import prisma from '../../../models'
import { RoomJoinFacade } from './roomJoinFacade'
import { HTTP_STATUS } from '../../../constants/httpStatus'
import { JoinGameUseCase } from '../../game/services/joinGameUseCase'

/** `POST /room/enter` 成功体：与 `room/join`、`game/join` 语义对齐，便于客户端统一解析 */
export type RoomEnterSuccessData = {
  roomId: number
  gameStatus: RoomGameStatus
  joinedAs: 'waiting_room' | 'game_table'
  gameRuntimeAttached: boolean
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
    roomCode: string
    userId: number
  }): Promise<RoomEnterResult> {
    const raw = typeof input.roomCode === 'string' ? input.roomCode : ''
    const code = raw.trim().toUpperCase()
    if (!code) {
      return {
        ok: false,
        status: HTTP_STATUS.BAD_REQUEST,
        message: '房间代码不能为空'
      }
    }

    const row = await prisma.room.findUnique({
      where: { code },
      select: { id: true, gameStatus: true, deletedAt: true }
    })
    if (!row || row.deletedAt) {
      return {
        ok: false,
        status: HTTP_STATUS.NOT_FOUND,
        message: '房间不存在或房间代码错误'
      }
    }

    if (row.gameStatus === 'waiting') {
      const r = await this.roomJoin.execute({
        roomCode: input.roomCode,
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
          gameRuntimeAttached: r.data.gameRuntimeAttached
        }
      }
    }

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

    return {
      ok: true,
      data: {
        roomId: row.id,
        gameStatus: row.gameStatus,
        joinedAs: 'game_table',
        gameRuntimeAttached: true
      }
    }
  }
}
