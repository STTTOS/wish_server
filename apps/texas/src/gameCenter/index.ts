import { Texas } from 'texas-poker-core'

// roomId(string) => Texas instance
const rooms = new Map<string, Texas>([])

export function getGame(roomId: string) {
  return rooms.get(roomId)
}

export function hasGame(roomId: string) {
  return rooms.has(roomId)
}
export function createGame(roomId: string, texas: Texas) {
  rooms.set(roomId, texas)
}

export function destroyGame(roomId: string) {
  const texas = rooms.get(roomId)
  if (texas) texas.reset()
  rooms.delete(roomId)
}
export { rooms }
