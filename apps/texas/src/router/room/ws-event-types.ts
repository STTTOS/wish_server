/**
 * Room 相关 WS 事件类型（按命名空间分组）：
 * - /waiting-room：waiting-room-*（房间内成员/房主管理）
 * - /room-list：room-list-*（房间列表维度变更）
 *
 * 注意：这些事件目前由 `SocketServer.broadcastWaitingRoom` 与 `broadcastRoomList` 发出，
 * 不走全局 `apps/texas/src/ws/ws-event-types.ts`（那份主要是对局内 /game 事件）。
 */

export type WsWaitingRoomMemberJoinedData = {
  userId: number
  name: string
  avatarUrl: string | null
  avatarKey: string
  joinedAt: string
  isOwner: boolean
}

export type WsWaitingRoomMemberLeftData = {
  userId: number
  reason: 'quit' | 'kick'
  /** 仅 reason=kick 时存在（执行踢人操作的用户） */
  operatorId?: number
}

/** WS 层在线状态（杀进程、断网等）；成员仍在 DB 中，与 HTTP 退房的 member-left 不同 */
export type WsWaitingRoomMemberPresenceData = {
  userId: number
  online: boolean
}

export type WsWaitingRoomOwnerChangedData = {
  oldOwnerId: number
  newOwnerId: number
}

export type WsRoomListMemberCountChangedData = {
  roomId: number
  memberCount: number
}

export type WsRoomListRoomDeletedData = {
  roomId: number
}

export type WsRoomListRoomCreatedData = {
  id: number
  code: string
  owner: {
    id: number
    name: string
    avatarUrl: string | null
    avatarKey: string
  }
  initialChips: number
  thinkingTime: number
  lowestBetAmount: number
  createdAt: string
  memberCount: number
}

export type RoomWsEventDataMap = {
  // /waiting-room
  'waiting-room-member-joined': WsWaitingRoomMemberJoinedData
  'waiting-room-member-left': WsWaitingRoomMemberLeftData
  'waiting-room-member-presence': WsWaitingRoomMemberPresenceData
  'waiting-room-owner-changed': WsWaitingRoomOwnerChangedData

  // /room-list
  'room-list-member-count-changed': WsRoomListMemberCountChangedData
  'room-list-room-deleted': WsRoomListRoomDeletedData
  'room-list-room-created': WsRoomListRoomCreatedData
}

export type RoomWsEventType = keyof RoomWsEventDataMap

export type RoomWsMessage<T extends RoomWsEventType = RoomWsEventType> = {
  type: T
  data: RoomWsEventDataMap[T]
}
