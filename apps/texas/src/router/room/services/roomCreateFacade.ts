import type { ApiResult } from '../../../utils/apiResult'
import type { WaitingRoomGateway } from './waitingRoomGateway'

import dayjs from 'dayjs'

import prisma from '../../../models'
import { timeFormat } from '../../../config'
import { generateRoomCode } from '../../../utils/roomCode'
import { HTTP_STATUS } from '../../../constants/httpStatus'
import {
  type RoomCreateInput,
  validateRoomCreateAuth
} from './roomCreateValidator'

export type RoomCreateResult = ApiResult<{ roomId: number; roomCode: string }>

export class RoomCreateFacade {
  constructor(private readonly waitingRoomGateway: WaitingRoomGateway) {}

  async execute(input: RoomCreateInput): Promise<RoomCreateResult> {
    const validated = validateRoomCreateAuth(input)
    if (!validated.ok) return validated
    const { userId, isPrivate, thinkingTime, lowestBetAmount, initialChips } =
      validated.data

    const created = await prisma.$transaction(async (tx) => {
      const userInfo = await tx.user.findUnique({
        where: { id: userId },
        select: { id: true, name: true, avatarUrl: true, avatarKey: true }
      })
      if (!userInfo) {
        return {
          ok: false as const,
          status: HTTP_STATUS.NOT_FOUND,
          message: '玩家不存在, 无法创建房间'
        }
      }

      const joinedRoom = await tx.roomMember.findFirst({
        where: {
          userId,
          room: { deletedAt: null }
        }
      })
      if (joinedRoom) {
        return {
          ok: false as const,
          status: HTTP_STATUS.CONFLICT,
          message: '你已在房间中, 请先退出后再创建房间'
        }
      }

      const roomExisted = await tx.room.findFirst({
        where: { ownerId: userId, deletedAt: null }
      })
      if (roomExisted) {
        return {
          ok: false as const,
          status: HTTP_STATUS.CONFLICT,
          message: '不可重复创建房间'
        }
      }

      const roomCode = generateRoomCode()
      const createdRoom = await tx.room.create({
        data: {
          code: roomCode,
          isPrivate,
          thinkingTime,
          lowestBetAmount,
          initialChips,
          ownerId: userInfo.id
        }
      })
      await tx.roomMember.create({
        data: { roomId: createdRoom.id, userId: userInfo.id }
      })

      return {
        ok: true as const,
        data: {
          roomId: createdRoom.id,
          roomCode,
          room: createdRoom,
          owner: userInfo
        }
      }
    })

    if (!created.ok) {
      return created
    }
    const { room, owner, roomId, roomCode } = created.data
    const { id, code, createdAt } = room

    this.waitingRoomGateway.broadcastRoomListRoomCreated({
      id,
      code,
      owner,
      initialChips: room.initialChips,
      thinkingTime: room.thinkingTime,
      lowestBetAmount: room.lowestBetAmount,
      createdAt: dayjs(createdAt).format(timeFormat),
      memberCount: 1
    })

    return {
      ok: true,
      data: { roomId, roomCode }
    }
  }
}
