import { Texas } from 'texas-poker-core'

// roomId => Texas instance
const rooms = new Map<string, Texas>([])
// room(Set(user1, user2))
// const userIdInRoomMap = new Map<string, Set<number>>()
// userId => roomId
const userIdToRoomMap = new Map<number, string>()
export function createRoom(roomId: string, userId: number, texas: Texas) {
  rooms.set(roomId, texas)

  // userIdInRoomMap.set(roomId, new Set([userId]))
  userIdToRoomMap.set(userId, roomId)
}
export function joinRoom(roomId: string, userId: number) {
  // userIdInRoomMap.set(roomId, userIdInRoomMap.get(roomId)!.add(userId))
  userIdToRoomMap.set(userId, roomId)
}
export function leaveRoom(roomId: string, userId: number) {
  // userIdInRoomMap.get(roomId)!.delete(userId)
  userIdToRoomMap.delete(userId)
}
export function getRoomId(userId: number) {
  return userIdToRoomMap.get(userId)
}
export { rooms }
