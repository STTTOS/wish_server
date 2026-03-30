/**
 * 房间 HTTP 编排层（与 `router/game/services/flow` 对齐）。
 */
export { WaitingRoomGateway } from '../waitingRoomGateway'
export { RoomMembersFacade } from '../roomMembersFacade'
export { RoomCreateFacade } from '../roomCreateFacade'
export type { RoomCreateResult } from '../roomCreateFacade'
export { RoomJoinFacade } from '../roomJoinFacade'
export type { RoomJoinResult } from '../roomJoinFacade'
export { RoomQuitFacade } from '../roomQuitFacade'
export type { RoomQuitResult } from '../roomQuitFacade'
export { RoomKickFacade } from '../roomKickFacade'
export type { RoomKickResult } from '../roomKickFacade'
export type {
  RoomMemberClientRow,
  GetRoomMembersResult
} from '../roomMembersFacade'
