import type { ApiResult } from '../../../utils/apiResult'
import type { WaitingRoomGateway } from './waitingRoomGateway'

import dayjs from 'dayjs'

import { timeFormat } from '../../../config'
import { roomMember } from '../../../models'
import { validateRoomMembersAuth } from './roomMembersValidator'

export type RoomMemberClientRow = {
  userId: number
  name: string
  avatarUrl: string | null
  avatarKey: string
  joinedAt: string
  isOwner: boolean
  /** 是否在等待房或游戏房任一 WS 通道在线 */
  isOnline: boolean
  /** 是否仅在 `/waiting-room` 在线 */
  isWaitingRoomOnline: boolean
}

export type GetRoomMembersResult = ApiResult<{
  members: RoomMemberClientRow[]
}>

/**
 * Facade：拉取「房间成员 + WS 在线态」的唯一入口。
 */
export class RoomMembersFacade {
  constructor(private readonly gateway: WaitingRoomGateway) {}

  async execute(input: {
    roomCode: string
    userId: number
  }): Promise<GetRoomMembersResult> {
    const auth = await validateRoomMembersAuth(input)
    if (!auth.ok) return auth
    const { roomId, ownerId } = auth.data
    const members = await this.#buildRows(roomId, ownerId)
    return { ok: true, data: { members } }
  }

  async #buildRows(
    roomId: number,
    ownerId: number
  ): Promise<RoomMemberClientRow[]> {
    const { waiting, game } = this.gateway.getPresence(roomId)
    const rows = await roomMember.findMany({
      where: { roomId },
      include: { user: true },
      orderBy: { joinedAt: 'asc' }
    })
    return rows.map(({ joinedAt, user: u }) => {
      const onWaiting = waiting.has(u.id)
      const onGame = game.has(u.id)
      return {
        userId: u.id,
        name: u.name,
        avatarUrl: u.avatarUrl,
        avatarKey: u.avatarKey,
        joinedAt: dayjs(joinedAt).format(timeFormat),
        isOwner: ownerId === u.id,
        isOnline: onWaiting || onGame,
        isWaitingRoomOnline: onWaiting
      }
    })
  }
}
