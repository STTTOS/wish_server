import type { ApiVoidResult } from '../../../utils/apiResult'

import {
  TexasError,
  TexasCoreErrorCode,
  isFatalTexasErrorCode
} from 'texas-poker-core'

import prisma from '../../../models'
import { gameRuntimeRegistry } from './runtimeRegistry'
import { HTTP_STATUS } from '../../../constants/httpStatus'
import { drainAndInterpretTexas } from './texasDomain/drainTexasDomainEvents'
import { getTexasEventContextForRoom } from './texasDomain/texasEventContext'
import { handleFatalTexasEngineError } from './texasDomain/handleFatalTexasEngineError'

/**
 * 中途进入 Core 牌桌（须已是 `RoomMember`）：
 * - DB `gameStatus !== 'waiting'`（仍在等人阶段不可进引擎桌）。
 * - Core `room.status === 'seats_locked'`（本手锁座）：仅 `join` 观战。
 * - `seats_open`（局间开放入座）：`join` 后 `seat`；已在观战则补 `seat`。
 * 幂等：已在座直接成功；已观战且锁座直接成功；`seat` 遇「已在座」按成功处理。
 */
export class JoinGameUseCase {
  async execute(input: {
    userId: number
    roomId: number
  }): Promise<ApiVoidResult> {
    const { userId, roomId } = input
    const roomKey = String(roomId)

    const pre = await prisma.room.findUnique({
      where: { id: roomId },
      select: { id: true, gameStatus: true, deletedAt: true }
    })
    if (!pre || pre.deletedAt) {
      return {
        ok: false,
        status: HTTP_STATUS.NOT_FOUND,
        message: '房间不存在'
      }
    }
    if (pre.gameStatus === 'waiting') {
      return {
        ok: false,
        status: HTTP_STATUS.CONFLICT,
        message: '当前阶段不可加入对局'
      }
    }

    const member = await prisma.roomMember.findUnique({
      where: { roomId_userId: { roomId, userId } },
      select: { userId: true }
    })
    if (!member) {
      return {
        ok: false,
        status: HTTP_STATUS.FORBIDDEN,
        message: '请先加入房间'
      }
    }

    const texas = gameRuntimeRegistry.getTexas(roomKey)
    if (!texas) {
      return {
        ok: false,
        status: HTTP_STATUS.CONFLICT,
        message: '对局尚未就绪，请稍后再试'
      }
    }

    const engineRoomStatus = texas.room.status

    try {
      const seatStatus = texas.room.getPlayerSeatStatusById(userId)
      if (seatStatus === 'on-set') {
        return { ok: true, data: null }
      }
      if (seatStatus === 'hang') {
        if (engineRoomStatus === 'seats_open') {
          texas.room.seatById(userId)
          await drainAndInterpretTexas(getTexasEventContextForRoom(roomKey))
        }
        return { ok: true, data: null }
      }

      const userRow = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, name: true }
      })
      if (!userRow) {
        return {
          ok: false,
          status: HTTP_STATUS.NOT_FOUND,
          message: '用户不存在'
        }
      }

      const player = texas.createPlayer({
        id: userRow.id,
        name: userRow.name
      })

      if (engineRoomStatus === 'seats_locked') {
        texas.room.join(player)
      } else {
        texas.room.join(player)
        texas.room.seat(player)
      }
      await drainAndInterpretTexas(getTexasEventContextForRoom(roomKey))
      return { ok: true, data: null }
    } catch (e: unknown) {
      if (e instanceof TexasError) {
        if (e.code === TexasCoreErrorCode.ROOM_SEAT_ALREADY) {
          return { ok: true, data: null }
        }
        if (e.code === TexasCoreErrorCode.ROOM_DUPLICATE_JOIN) {
          const st = texas.room.getPlayerSeatStatusById(userId)
          if (st === 'on-set') {
            return { ok: true, data: null }
          }
          if (st === 'hang' && texas.room.status === 'seats_open') {
            try {
              texas.room.seatById(userId)
              await drainAndInterpretTexas(getTexasEventContextForRoom(roomKey))
            } catch (inner: unknown) {
              if (
                inner instanceof TexasError &&
                inner.code === TexasCoreErrorCode.ROOM_SEAT_ALREADY
              ) {
                return { ok: true, data: null }
              }
              if (
                inner instanceof TexasError &&
                isFatalTexasErrorCode(inner.code)
              ) {
                await handleFatalTexasEngineError({
                  error: inner,
                  roomId,
                  roomKey,
                  getRuntime: () => gameRuntimeRegistry.getOrThrow(roomKey)
                })
              }
              const msg =
                inner instanceof Error ? inner.message : '加入对局失败'
              return { ok: false, status: HTTP_STATUS.CONFLICT, message: msg }
            }
          }
          if (st === 'hang') {
            return { ok: true, data: null }
          }
        }
        if (isFatalTexasErrorCode(e.code)) {
          await handleFatalTexasEngineError({
            error: e,
            roomId,
            roomKey,
            getRuntime: () => gameRuntimeRegistry.getOrThrow(roomKey)
          })
        }
      }
      const message = e instanceof Error ? e.message : '加入对局失败'
      return { ok: false, status: HTTP_STATUS.CONFLICT, message }
    }
  }
}
