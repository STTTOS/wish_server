import type { ApiVoidResult } from '../../../utils/apiResult'
import type { WaitingRoomGateway } from './waitingRoomGateway'
import type { WsWaitingRoomMemberJoinedData } from '../ws-event-types'

import dayjs from 'dayjs'

import prisma from '../../../models'
import { timeFormat } from '../../../config'
import { validateRoomJoinAuth } from './roomJoinValidator'
import { MAX_PLAYERS_COUNT } from '../../../constants/game'
import { HTTP_STATUS } from '../../../constants/httpStatus'

export type RoomJoinResult = ApiVoidResult

/**
 * Facade：加入房间（事务写库 + WS 广播）
 */
export class RoomJoinFacade {
  constructor(private readonly waitingRoomGateway: WaitingRoomGateway) {}

  async execute(input: {
    roomCode: string
    userId: number
  }): Promise<RoomJoinResult> {
    const auth = await validateRoomJoinAuth(input)
    if (!auth.ok) return auth

    const { roomId, joinUser } = auth.data

    type RoomJoinTxResult =
      | { kind: 'noop' }
      | { kind: 'fail'; status: number; message: string }
      | {
          kind: 'joined'
          memberCountAfterJoin: number
          ownerId: number
        }

    const txRes: RoomJoinTxResult = await prisma.$transaction(async (tx) => {
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
          message: '仅等待房间状态支持加入房间'
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
        // 幂等：重复加入同一房间，视为 no-op，返回成功但不广播、不增人数
        return { kind: 'noop' }
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

    switch (txRes.kind) {
      case 'noop':
        return { ok: true, data: null }
      case 'fail':
        return { ok: false, status: txRes.status, message: txRes.message }
      case 'joined':
        break
    }

    const memberPayload: WsWaitingRoomMemberJoinedData = {
      userId: joinUser.id,
      name: joinUser.name,
      avatarUrl: joinUser.avatarUrl,
      avatarKey: joinUser.avatarKey,
      pokerBackgroundKey: joinUser.pokerBackgroundKey ?? 'default',
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

    return { ok: true, data: null }
  }
}
