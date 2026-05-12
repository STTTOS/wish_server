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
  pokerBackgroundKey: string
  tableBackgroundKey: string
  joinedAt: string
  isOwner: boolean
  /**
   * 是否在 `/waiting-room` 本房已连接；与 WS `waiting-room-member-presence` 的 `state` 同源。
   * HTTP 拉成员时为当场快照，断线后客户端应依赖 presence 或再次请求 members。
   */
  isWaitingRoomOnline: boolean
}

export type GetRoomMembersResult = ApiResult<{
  members: RoomMemberClientRow[]
}>

/**
 * Facade：拉取「房间成员 + waiting-room 在线快照」的统一入口。
 */
export class RoomMembersFacade {
  constructor(private readonly gateway: WaitingRoomGateway) {}

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
    const { waiting } = this.gateway.getPresence(roomId)
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
      const onWaiting = waiting.has(u.id)
      return {
        userId: u.id,
        name: u.name,
        avatarUrl: u.avatarUrl,
        avatarKey: u.avatarKey,
        pokerBackgroundKey: u.pokerBackgroundKey,
        tableBackgroundKey: u.tableBackgroundKey,
        joinedAt: dayjs(joinedAt).format(timeFormat),
        isOwner: ownerId === u.id,
        isWaitingRoomOnline: onWaiting
      }
    })
  }
}
