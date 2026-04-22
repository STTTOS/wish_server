/**
 * 单一协议来源：room-list / waiting-room 的 WS 合同统一由共享包提供。
 */
export type {
  RoomWsEventDataMap,
  RoomWsEventType,
  RoomWsMessage,
  WsRoomListMemberCountChangedData,
  WsRoomListPlaySession,
  WsRoomListPlaySessionChangedData,
  WsRoomListRoomCreatedData,
  WsRoomListRoomDeletedData,
  WsWaitingRoomMemberJoinedData,
  WsWaitingRoomMemberLeftData,
  WsWaitingRoomMemberPresenceData,
  WsWaitingRoomOwnerChangedData
} from '@wishufree/texas-ws-contract'
