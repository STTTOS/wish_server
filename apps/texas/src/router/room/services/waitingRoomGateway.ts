import type SocketServer from '../../../SockeServer'
import type {
  RoomWsMessage,
  WsRoomListRoomCreatedData,
  WsRoomListRoomDeletedData,
  WsWaitingRoomMemberLeftData,
  WsWaitingRoomMemberJoinedData,
  WsWaitingRoomOwnerChangedData,
  WsRoomListMemberCountChangedData
} from '../ws-event-types'

/**
 * 等待房 / 游戏房 WS 在线态查询入口（Facade 与路由不直接依赖 SocketServer 细节）。
 */
export class WaitingRoomGateway {
  constructor(private readonly socket: SocketServer) {}

  /** 同一房间在 waiting-room / game 命名空间下的在线用户集合 */
  getPresence(roomId: number): {
    waiting: Set<number>
    game: Set<number>
  } {
    const waiting = this.socket.getWaitingRoomOnlineUserIds(roomId)
    const game = new Set(
      this.socket.getConnectedGameRoomUserIds(String(roomId))
    )
    return { waiting, game }
  }

  broadcastWaitingRoomMemberJoined(
    roomId: number,
    data: WsWaitingRoomMemberJoinedData
  ) {
    const msg: RoomWsMessage<'waiting-room-member-joined'> = {
      type: 'waiting-room-member-joined',
      data
    }
    this.socket.broadcastWaitingRoom(roomId, msg)
  }

  broadcastRoomListMemberCountChanged(roomId: number, memberCount: number) {
    const data: WsRoomListMemberCountChangedData = { roomId, memberCount }
    const msg: RoomWsMessage<'room-list-member-count-changed'> = {
      type: 'room-list-member-count-changed',
      data
    }
    this.socket.broadcastRoomList(msg)
  }

  broadcastWaitingRoomOwnerChanged(
    roomId: number,
    data: WsWaitingRoomOwnerChangedData
  ) {
    const msg: RoomWsMessage<'waiting-room-owner-changed'> = {
      type: 'waiting-room-owner-changed',
      data
    }
    this.socket.broadcastWaitingRoom(roomId, msg)
  }

  broadcastWaitingRoomMemberLeft(
    roomId: number,
    data: WsWaitingRoomMemberLeftData
  ) {
    const msg: RoomWsMessage<'waiting-room-member-left'> = {
      type: 'waiting-room-member-left',
      data
    }
    this.socket.broadcastWaitingRoom(roomId, msg)
  }

  broadcastRoomListRoomDeleted(roomId: number) {
    const data: WsRoomListRoomDeletedData = { roomId }
    const msg: RoomWsMessage<'room-list-room-deleted'> = {
      type: 'room-list-room-deleted',
      data
    }
    this.socket.broadcastRoomList(msg)
  }

  broadcastRoomListRoomCreated(data: WsRoomListRoomCreatedData) {
    const msg: RoomWsMessage<'room-list-room-created'> = {
      type: 'room-list-room-created',
      data
    }
    this.socket.broadcastRoomList(msg)
  }

  removeUserFromWaitingRoom(roomId: number, userId: number) {
    this.socket.removeUserFromWaitingRoom(roomId, userId)
  }
}
