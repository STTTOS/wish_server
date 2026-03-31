import type { RoleEnum } from 'texas-poker-core'
import type { WsMessage } from '../../../ws/ws-event-types'
import type { RoomWsMessage } from '../../room/ws-event-types'

import { ws } from '../../../server'

/**
 * Game WS 网关：封装“开始游戏流程”相关的 WS 发送与等待动作。
 */
export class GameWsGateway {
  notifyEntered(roomId: number, matchId: number, userIds: number[]) {
    const msg: WsMessage<'game-entered'> = {
      type: 'game-entered',
      data: { roomId, matchId, userIds }
    }
    ws.broadcastWaitingRoom(roomId, msg)
  }

  notifyEntering(roomId: number) {
    const msg: WsMessage<'game-entering'> = {
      type: 'game-entering',
      data: { roomId }
    }
    ws.broadcastWaitingRoom(roomId, msg)
  }

  notifyEnteringResolved(data: WsMessage<'game-entering-resolved'>['data']) {
    const msg: WsMessage<'game-entering-resolved'> = {
      type: 'game-entering-resolved',
      data
    }
    ws.broadcastWaitingRoom(data.roomId, msg)
  }

  notifyGameInvalidated(
    data: WsMessage<'game-invalidated'>['data'],
    roomKey: string
  ) {
    const msg: WsMessage<'game-invalidated'> = {
      type: 'game-invalidated',
      data
    }
    ws.broadcastGameRoom(roomKey, msg)
  }

  notifyActionRequired(
    roomKey: string,
    data: WsMessage<'player-action-required'>['data']
  ) {
    ws.broadcastGameRoom(roomKey, { type: 'player-action-required', data })
  }

  notifyActionTaken(
    roomKey: string,
    data: WsMessage<'player-action-taken'>['data']
  ) {
    ws.broadcastGameRoom(roomKey, { type: 'player-action-taken', data })
  }

  notifyStageChanged(
    roomKey: string,
    data: WsMessage<'game-stage-changed'>['data']
  ) {
    ws.broadcastGameRoom(roomKey, { type: 'game-stage-changed', data })
  }

  notifyGameStart(roomKey: string, data: WsMessage<'game-start'>['data']) {
    ws.broadcastGameRoom(roomKey, { type: 'game-start', data })
  }

  notifyGameEnd(roomKey: string, data: WsMessage<'game-end'>['data']) {
    ws.broadcastGameRoom(roomKey, { type: 'game-end', data })
  }

  notifyRolesAssigned(
    roomKey: string,
    matchId: number,
    roles: Array<{ userId: number; role: RoleEnum }>
  ) {
    ws.broadcastGameRoom(roomKey, {
      type: 'player-roles-assigned',
      data: { matchId, roles }
    })
  }

  notifyHandDealtToUser(
    userId: number,
    data: WsMessage<'player-hand-dealt'>['data']
  ) {
    ws.broadcastGameToUser(userId, { type: 'player-hand-dealt', data })
  }

  trackEntering(roomId: number, expectedUserIds: number[]) {
    ws.trackGameEntering(roomId, expectedUserIds)
  }

  untrackEntering(roomId: number) {
    ws.untrackGameEntering(roomId)
  }

  waitForAllGameConnections(
    roomKey: string,
    userIds: number[],
    timeoutMs = 20_000
  ) {
    return ws.waitForGameRoomUsersConnected(roomKey, userIds, { timeoutMs })
  }

  getConnectedGameRoomUserIds(roomKey: string) {
    return ws.getConnectedGameRoomUserIds(roomKey)
  }

  broadcastWaitingRoomMemberLeft(
    roomId: number,
    data: RoomWsMessage<'waiting-room-member-left'>['data']
  ) {
    const msg: RoomWsMessage<'waiting-room-member-left'> = {
      type: 'waiting-room-member-left',
      data
    }
    ws.broadcastWaitingRoom(roomId, msg)
  }

  broadcastWaitingRoomOwnerChanged(
    roomId: number,
    data: RoomWsMessage<'waiting-room-owner-changed'>['data']
  ) {
    const msg: RoomWsMessage<'waiting-room-owner-changed'> = {
      type: 'waiting-room-owner-changed',
      data
    }
    ws.broadcastWaitingRoom(roomId, msg)
  }

  broadcastRoomListMemberCountChanged(
    data: RoomWsMessage<'room-list-member-count-changed'>['data']
  ) {
    const msg: RoomWsMessage<'room-list-member-count-changed'> = {
      type: 'room-list-member-count-changed',
      data
    }
    ws.broadcastRoomList(msg)
  }

  broadcastRoomListRoomDeleted(roomId: number) {
    const msg: RoomWsMessage<'room-list-room-deleted'> = {
      type: 'room-list-room-deleted',
      data: { roomId }
    }
    ws.broadcastRoomList(msg)
  }

  removeUserFromWaitingRoom(roomId: number, userId: number) {
    ws.removeUserFromWaitingRoom(roomId, userId)
  }

  disconnectUserRoomSockets(roomId: number, userId: number) {
    ws.disconnectUserRoomSockets(roomId, userId)
  }
}
