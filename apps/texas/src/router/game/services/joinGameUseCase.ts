import type { ApiVoidResult } from '../../../utils/apiResult'

import { Prisma } from '@prisma/texas-client'
import {
  TexasError,
  TexasCoreErrorCode,
  isFatalTexasErrorCode
} from 'texas-poker-core'

import prisma from '../../../models'
import { GameWsGateway } from './gameWsGateway'
import { gameRuntimeRegistry } from './runtimeRegistry'
import { HTTP_STATUS } from '../../../constants/httpStatus'
import { MAX_PLAYERS_COUNT } from '../../../constants/game'
import { drainAndInterpretTexas } from './texasDomain/drainTexasDomainEvents'
import { getTexasEventContextForRoom } from './texasDomain/texasEventContext'
import { handleFatalTexasEngineError } from './texasDomain/handleFatalTexasEngineError'

type EnsureMemberTxResult =
  | { kind: 'fail'; status: number; message: string }
  | { kind: 'already_member' }
  | { kind: 'created' }

/**
 * **非 waiting** 时进入 Core 牌桌（`POST /game/join`）：
 * - 若尚无 `RoomMember`，本用例内事务写入成员（与等待房入表规则一致），再挂引擎；引擎失败则删回该成员。
 * - DB `gameStatus === 'waiting'` 时不可调用（应使用 `POST /room/join`）。
 * - Core `room.status === 'seats_locked'`：仅 `join` 观战；`seats_open`：`join` 后 `seat`。
 */
export class JoinGameUseCase {
  #wsGateway = new GameWsGateway()

  async #ensureRoomMemberForNonWaitingRoom(input: {
    roomId: number
    userId: number
  }): Promise<
    | { ok: true; createdNewMember: boolean }
    | { ok: false; status: number; message: string }
  > {
    const { roomId, userId } = input
    try {
      const txRes: EnsureMemberTxResult = await prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM \`Room\` WHERE id = ${roomId} FOR UPDATE`

          const latestRoom = await tx.room.findUnique({
            where: { id: roomId },
            select: { id: true, deletedAt: true, gameStatus: true }
          })

          if (!latestRoom || latestRoom.deletedAt) {
            return {
              kind: 'fail',
              status: HTTP_STATUS.NOT_FOUND,
              message: '房间不存在'
            }
          }
          if (latestRoom.gameStatus === 'waiting') {
            return {
              kind: 'fail',
              status: HTTP_STATUS.CONFLICT,
              message: '当前阶段请使用加入房间接口（POST /room/join）'
            }
          }

          const existing = await tx.roomMember.findUnique({
            where: { roomId_userId: { roomId, userId } } // eslint-disable-line camelcase
          })
          if (existing) {
            return { kind: 'already_member' }
          }

          const memberCount = await tx.roomMember.count({ where: { roomId } })
          if (memberCount >= MAX_PLAYERS_COUNT) {
            return {
              kind: 'fail',
              status: HTTP_STATUS.CONFLICT,
              message: '房间已满'
            }
          }

          const inOtherRoomLatest = await tx.roomMember.findFirst({
            where: {
              userId,
              room: { id: { not: roomId }, deletedAt: null }
            }
          })
          if (inOtherRoomLatest) {
            return {
              kind: 'fail',
              status: HTTP_STATUS.CONFLICT,
              message: '你已在其他房间中，请先退出后再加入'
            }
          }

          await tx.roomMember.create({ data: { roomId, userId } })
          return { kind: 'created' }
        }
      )

      if (txRes.kind === 'fail') {
        return { ok: false, status: txRes.status, message: txRes.message }
      }
      return {
        ok: true,
        createdNewMember: txRes.kind === 'created'
      }
    } catch (e: unknown) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        return { ok: true, createdNewMember: false }
      }
      throw e
    }
  }

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
        message: '当前阶段请使用加入房间接口（POST /room/join）'
      }
    }

    let createdNewMember = false
    const member = await prisma.roomMember.findUnique({
      where: { roomId_userId: { roomId, userId } },
      select: { userId: true }
    })
    if (!member) {
      const ensured = await this.#ensureRoomMemberForNonWaitingRoom({
        roomId,
        userId
      })
      if (!ensured.ok) {
        return { ok: false, status: ensured.status, message: ensured.message }
      }
      createdNewMember = ensured.createdNewMember
      if (createdNewMember) {
        const memberCount = await prisma.roomMember.count({ where: { roomId } })
        this.#wsGateway.broadcastRoomListMemberCountChanged({
          roomId,
          memberCount
        })
      }
    }

    const texas = gameRuntimeRegistry.getTexas(roomKey)
    if (!texas) {
      if (createdNewMember) {
        await prisma.roomMember.delete({
          where: { roomId_userId: { roomId, userId } } // eslint-disable-line camelcase
        })
        const memberCount = await prisma.roomMember.count({ where: { roomId } })
        this.#wsGateway.broadcastRoomListMemberCountChanged({
          roomId,
          memberCount
        })
      }
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
        /**
         * 本手中途离场后仍在环上 on-set：`pendingLeave` 整手有效，不在此清除、不推 roster
         * （避免 seat/watcher 双写；手末 `HandEnded` 与观战入座一并推 `game-table-roster`）。
         */
        return { ok: true, data: null }
      }
      if (seatStatus === 'hang') {
        if (engineRoomStatus === 'seats_open') {
          texas.room.seatById(userId)
          gameRuntimeRegistry.enqueuePendingPostBigBlind(roomKey, userId)
          const runtime = gameRuntimeRegistry.getOrThrow(roomKey)
          this.#wsGateway.notifyPlayersPostedBigBlind(roomKey, {
            roomId,
            matchId: runtime.currentMatchId,
            seatedUserIds: [userId],
            posts: [],
            pool: texas.pool.totalAmount
          })
          await drainAndInterpretTexas(getTexasEventContextForRoom(roomKey))
          await this.#wsGateway.notifyGameTableRosterFromRuntime(
            roomKey,
            roomId
          )
        }
        return { ok: true, data: null }
      }

      const userRow = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, name: true }
      })
      if (!userRow) {
        if (createdNewMember) {
          await prisma.roomMember.delete({
            where: { roomId_userId: { roomId, userId } } // eslint-disable-line camelcase
          })
        }
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
        gameRuntimeRegistry.enqueuePendingPostBigBlind(roomKey, userId)
        const runtime = gameRuntimeRegistry.getOrThrow(roomKey)
        this.#wsGateway.notifyPlayersPostedBigBlind(roomKey, {
          roomId,
          matchId: runtime.currentMatchId,
          seatedUserIds: [userId],
          posts: [],
          pool: texas.pool.totalAmount
        })
      }
      await drainAndInterpretTexas(getTexasEventContextForRoom(roomKey))
      await this.#wsGateway.notifyGameTableRosterFromRuntime(roomKey, roomId)
      return { ok: true, data: null }
    } catch (e: unknown) {
      const rollbackMemberIfNeeded = async () => {
        if (!createdNewMember) return
        try {
          await prisma.roomMember.delete({
            where: { roomId_userId: { roomId, userId } } // eslint-disable-line camelcase
          })
          const memberCount = await prisma.roomMember.count({
            where: { roomId }
          })
          this.#wsGateway.broadcastRoomListMemberCountChanged({
            roomId,
            memberCount
          })
        } catch {
          /* ignore */
        }
      }

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
              await this.#wsGateway.notifyGameTableRosterFromRuntime(
                roomKey,
                roomId
              )
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
              await rollbackMemberIfNeeded()
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
      await rollbackMemberIfNeeded()
      return { ok: false, status: HTTP_STATUS.CONFLICT, message }
    }
  }
}
