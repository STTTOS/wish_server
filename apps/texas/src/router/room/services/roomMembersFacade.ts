import type { ApiResult } from '../../../utils/apiResult'

import dayjs from 'dayjs'

import { timeFormat } from '../../../config'
import { roomMember } from '../../../models'
import { validateRoomMembersAuth } from './roomMembersValidator'

export type RoomMemberClientRow = {
  userId: number
  name: string
  avatarUrl: string | null
  avatarKey: string
  pokerBackgroundKey: string
  tableBackgroundKey: string
  joinedAt: string
  isOwner: boolean
}

export type GetRoomMembersResult = ApiResult<{
  members: RoomMemberClientRow[]
}>

/**
 * Facade：拉取房间成员基础资料（在线态由 waiting-room presence 事件链维护）。
 */
export class RoomMembersFacade {
  async execute(input: {
    roomId: number
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
    const rows = await roomMember.findMany({
      where: { roomId },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            avatarUrl: true,
            avatarKey: true,
            pokerBackgroundKey: true,
            tableBackgroundKey: true
          }
        }
      },
      orderBy: { joinedAt: 'asc' }
    })
    return rows.map(({ joinedAt, user: u }) => {
      return {
        userId: u.id,
        name: u.name,
        avatarUrl: u.avatarUrl,
        avatarKey: u.avatarKey,
        pokerBackgroundKey: u.pokerBackgroundKey,
        tableBackgroundKey: u.tableBackgroundKey,
        joinedAt: dayjs(joinedAt).format(timeFormat),
        isOwner: ownerId === u.id
      }
    })
  }
}
