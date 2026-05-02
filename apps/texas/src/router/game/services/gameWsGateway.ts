import type {
  WsMessage,
  RoomWsMessage,
  WsPlayerLeftGameData,
  WsPlayerQuitGameData,
  WsPlayerRolesAssignedData,
  WsPlayerHandVoluntarilyShownData
} from '@wishufree/texas-ws-contract'

import { ws } from '../../../server'
import { gameRuntimeRegistry } from './runtimeRegistry'
import { buildGameTableRosterData } from './currentGameStateSnapshot'

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

  notifyGameBlindsPosted(
    roomKey: string,
    data: WsMessage<'game-blinds-posted'>['data']
  ) {
    ws.broadcastGameRoom(roomKey, { type: 'game-blinds-posted', data })
  }

  notifyPlayerChipTopUp(
    roomKey: string,
    data: WsMessage<'player-chip-top-up'>['data']
  ) {
    ws.broadcastGameRoom(roomKey, { type: 'player-chip-top-up', data })
  }

  notifyPlayerBuiltInVoice(
    roomKey: string,
    data: WsMessage<'player-built-in-voice'>['data']
  ) {
    ws.broadcastGameRoom(roomKey, { type: 'player-built-in-voice', data })
  }

  notifyGameEnd(roomKey: string, data: WsMessage<'game-end'>['data']) {
    ws.broadcastGameRoom(roomKey, { type: 'game-end', data })
  }

  /**
   * 结算广播：同一事件类型，按连接用户掩码 payload（如弃牌者仅本人可见 handPokes）。
   */
  notifyGameEndPerViewer(
    roomKey: string,
    buildData: (viewerUserId: number) => WsMessage<'game-end'>['data']
  ) {
    ws.broadcastGameEach(roomKey, (viewerUserId) => ({
      type: 'game-end' as const,
      data: buildData(viewerUserId)
    }))
  }

  notifyRolesAssigned(roomKey: string, data: WsPlayerRolesAssignedData) {
    ws.broadcastGameRoom(roomKey, {
      type: 'player-roles-assigned',
      data
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

  broadcastRoomListPlaySessionChanged(
    data: RoomWsMessage<'room-list-play-session-changed'>['data']
  ) {
    const msg: RoomWsMessage<'room-list-play-session-changed'> = {
      type: 'room-list-play-session-changed',
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

  disconnectUserGameSockets(roomId: number, userId: number) {
    ws.disconnectUserGameSockets(roomId, userId)
  }

  /**
   * 仅向离场玩家单播（`/game` 不入全房 replay 缓冲）。
   * 其他客户端依赖 `game-table-roster` 更新牌桌在座/观战名单。
   */
  notifyPlayerQuitGame(_roomKey: string, data: WsPlayerQuitGameData) {
    const msg: WsMessage<'player-quit-game'> = {
      type: 'player-quit-game',
      data
    }
    ws.broadcastGameToUser(data.userId, msg)
  }

  notifyPlayerLeftGame(
    roomKey: string,
    data: WsPlayerLeftGameData,
    options?: { excludeUserId?: number }
  ) {
    const msg: WsMessage<'player-left-game'> = {
      type: 'player-left-game',
      data
    }
    if (options?.excludeUserId != null) {
      ws.broadcastGameRoomExcept(roomKey, options.excludeUserId, msg)
      return
    }
    ws.broadcastGameRoom(roomKey, msg)
  }

  notifyGameRoomClosed(
    roomKey: string,
    data: WsMessage<'game-room-closed'>['data']
  ) {
    ws.broadcastGameRoom(roomKey, {
      type: 'game-room-closed',
      data
    })
  }

  /** 从当前 Texas runtime 构造全量 `game-table-roster` 并广播；无 runtime 时 no-op。 */
  async notifyGameTableRosterFromRuntime(
    roomKey: string,
    roomId: number
  ): Promise<void> {
    const texas = gameRuntimeRegistry.getTexas(roomKey)
    if (!texas) return
    const rosterSeq = gameRuntimeRegistry.bumpGameTableRosterSeq(roomKey)
    const data = await buildGameTableRosterData({
      texas,
      roomId,
      roomKey,
      rosterSeq
    })
    ws.broadcastGameRoom(roomKey, {
      type: 'game-table-roster',
      data
    })
    ws.resyncGameRoomSeatPresence(
      roomKey,
      data.seats.map((s) => s.userId)
    )
  }

  notifyPlayersPostedBigBlind(
    roomKey: string,
    data: WsMessage<'players-posted-big-blind'>['data']
  ) {
    ws.broadcastGameRoom(roomKey, {
      type: 'players-posted-big-blind',
      data
    })
    if (data.seatedUserIds?.length) {
      ws.resyncGameRoomSeatPresence(roomKey, data.seatedUserIds)
    }
  }

  notifyPlayerHandVoluntarilyShown(
    roomKey: string,
    data: WsPlayerHandVoluntarilyShownData
  ) {
    const msg: WsMessage<'player-hand-voluntarily-shown'> = {
      type: 'player-hand-voluntarily-shown',
      data
    }
    ws.broadcastGameRoom(roomKey, msg)
  }
}
