import type { ApiResult } from '../../../utils/apiResult'
import type { RoomGameStatus } from '@prisma/texas-client'
import type { WaitingRoomGateway } from './waitingRoomGateway'
import type { WsWaitingRoomMemberJoinedData } from '@wishufree/texas-ws-contract'

import dayjs from 'dayjs'
import { Prisma } from '@prisma/texas-client'

import prisma from '../../../models'
import { timeFormat } from '../../../config'
import { validateRoomJoinAuth } from './roomJoinValidator'
import { MAX_PLAYERS_COUNT } from '../../../constants/game'
import { HTTP_STATUS } from '../../../constants/httpStatus'

/** `room/join` 成功时返回（仅 `waiting` 阶段会成功） */
export type RoomJoinSuccessData = {
  roomId: number
  gameStatus: RoomGameStatus
  joinedAs: 'waiting_room'
  gameRuntimeAttached: false
}

export type RoomJoinResult = ApiResult<RoomJoinSuccessData>

function roomJoinSuccess(
  roomId: number
): Extract<RoomJoinResult, { ok: true }> {
  return {
    ok: true,
    data: {
      roomId,
      gameStatus: 'waiting',
      joinedAs: 'waiting_room',
      gameRuntimeAttached: false
    }
  }
}

const USE_GAME_JOIN_MESSAGE =
  '对局已开始或不在等待阶段，请使用加入对局接口（POST /game/join，body 含 roomId）'

/**
 * Facade：仅 **等待阶段** 加入房间（事务写库 + 等待房 WS）。
 * 非 `waiting` 一律失败并提示改用 {@link JoinGameUseCase}（`POST /game/join`）。
 */
export class RoomJoinFacade {
  constructor(private readonly waitingRoomGateway: WaitingRoomGateway) {}

  async execute(input: {
    roomCode: string
    userId: number
  }): Promise<RoomJoinResult> {
    const auth = await validateRoomJoinAuth(input)
    if (!auth.ok) {
      return {
        ok: false,
        status: auth.status,
        message: auth.message,
        details: auth.details
      }
    }

    const { roomId, joinUser } = auth.data

    type RoomJoinTxResult =
      | { kind: 'already_member' }
      | { kind: 'fail'; status: number; message: string }
      | {
          kind: 'joined'
          memberCountAfterJoin: number
          ownerId: number
        }

    let txRes: RoomJoinTxResult
    try {
      txRes = await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM \`Room\` WHERE id = ${roomId} FOR UPDATE`

        const latestRoom = await tx.room.findUnique({
          where: { id: roomId },
          select: { id: true, ownerId: true, deletedAt: true, gameStatus: true }
        })

        if (!latestRoom || latestRoom.deletedAt) {
          return {
            kind: 'fail',
            status: HTTP_STATUS.NOT_FOUND,
            message: '房间不存在或房间代码错误'
          }
        }

        if (latestRoom.gameStatus !== 'waiting') {
          return {
            kind: 'fail',
            status: HTTP_STATUS.CONFLICT,
            message: USE_GAME_JOIN_MESSAGE
          }
        }

        const memberCount = await tx.roomMember.count({ where: { roomId } })
        if (memberCount >= MAX_PLAYERS_COUNT) {
          return {
            kind: 'fail',
            status: HTTP_STATUS.CONFLICT,
            message: '房间已满'
          }
        }

        const alreadyInRoom = await tx.roomMember.findUnique({
          where: {
            roomId_userId: { roomId, userId: input.userId } // eslint-disable-line camelcase
          }
        })
        if (alreadyInRoom) {
          return { kind: 'already_member' }
        }

        const inOtherRoomLatest = await tx.roomMember.findFirst({
          where: {
            userId: input.userId,
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

        await tx.roomMember.create({
          data: { roomId, userId: input.userId }
        })

        return {
          kind: 'joined',
          memberCountAfterJoin: memberCount + 1,
          ownerId: latestRoom.ownerId
        }
      })
    } catch (e: unknown) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        return roomJoinSuccess(roomId)
      }
      throw e
    }

    if (txRes.kind === 'fail') {
      return { ok: false, status: txRes.status, message: txRes.message }
    }

    if (txRes.kind === 'already_member') {
      return roomJoinSuccess(roomId)
    }

    const memberPayload: WsWaitingRoomMemberJoinedData = {
      userId: joinUser.id,
      name: joinUser.name,
      avatarUrl: joinUser.avatarUrl,
      avatarKey: joinUser.avatarKey,
      pokerBackgroundKey: joinUser.pokerBackgroundKey,
      joinedAt: dayjs().format(timeFormat),
      isOwner: txRes.ownerId === joinUser.id
    }

    this.waitingRoomGateway.broadcastWaitingRoomMemberJoined(
      roomId,
      memberPayload
    )
    this.waitingRoomGateway.broadcastRoomListMemberCountChanged(
      roomId,
      txRes.memberCountAfterJoin
    )

    return roomJoinSuccess(roomId)
  }
}
