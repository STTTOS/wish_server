import type { ApiResult } from '../../../utils/apiResult'
import type { WaitingRoomGateway } from './waitingRoomGateway'

import dayjs from 'dayjs'
import { Prisma } from '@prisma/texas-client'

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

    type TxRes =
      | { ok: false; status: number; message: string }
      | {
          ok: true
          kind: 'existing'
          data: { roomId: number; roomCode: string }
        }
      | {
          ok: true
          kind: 'created'
          data: {
            roomId: number
            roomCode: string
            createdAt: Date
            owner: {
              id: number
              name: string
              avatarUrl: string | null
              avatarKey: string
            }
          }
        }

    const txRes = await prisma.$transaction<TxRes>(
      async (tx): Promise<TxRes> => {
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
          },
          select: {
            room: {
              select: {
                id: true,
                code: true,
                ownerId: true
              }
            }
          }
        })
        if (joinedRoom) {
          if (joinedRoom.room.ownerId === userId) {
            // 幂等：用户已在自己房间中，重复创建直接返回同一个房间
            return {
              ok: true as const,
              kind: 'existing' as const,
              data: {
                roomId: joinedRoom.room.id,
                roomCode: joinedRoom.room.code
              }
            }
          }

          return {
            ok: false as const,
            status: HTTP_STATUS.CONFLICT,
            message: '你已在房间中, 请先退出后再创建房间'
          }
        }

        const roomCode = generateRoomCode()
        try {
          const createdRoom = await tx.room.create({
            data: {
              code: roomCode,
              isPrivate,
              thinkingTime,
              lowestBetAmount,
              initialChips,
              ownerId: userInfo.id,
              activeOwnerId: userInfo.id
            }
          })
          await tx.roomMember.create({
            data: { roomId: createdRoom.id, userId: userInfo.id }
          })

          return {
            ok: true as const,
            kind: 'created' as const,
            data: {
              roomId: createdRoom.id,
              roomCode,
              createdAt: createdRoom.createdAt,
              owner: userInfo
            }
          }
        } catch (error) {
          if (
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === 'P2002'
          ) {
            // 并发冲突统一回查 owner 的有效房间：
            // 查到则幂等成功，查不到再返回冲突。
            const existed = await tx.room.findFirst({
              where: { activeOwnerId: userId },
              select: { id: true, code: true }
            })
            if (existed) {
              // 并发冲突下幂等：唯一约束命中后返回已存在房间
              return {
                ok: true as const,
                kind: 'existing' as const,
                data: {
                  roomId: existed.id,
                  roomCode: existed.code
                }
              }
            }
            return {
              ok: false as const,
              status: HTTP_STATUS.CONFLICT,
              message: '创建房间冲突,请重试'
            }
          }
          throw error
        }
      }
    )

    if (!txRes.ok) {
      return txRes
    }
    if (txRes.kind === 'existing') {
      return {
        ok: true,
        data: { roomId: txRes.data.roomId, roomCode: txRes.data.roomCode }
      }
    }
    const { owner, roomId, roomCode, createdAt } = txRes.data

    this.waitingRoomGateway.broadcastRoomListRoomCreated({
      id: roomId,
      code: roomCode,
      owner,
      initialChips,
      thinkingTime,
      lowestBetAmount,
      createdAt: dayjs(createdAt).format(timeFormat),
      memberCount: 1
    })

    return {
      ok: true,
      data: { roomId, roomCode }
    }
  }
}
