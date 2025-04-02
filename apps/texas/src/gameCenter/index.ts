import { initialGame } from 'texas-poker-core'

type Texas = ReturnType<typeof initialGame>
const rooms = new Map<string, Texas>([])
export { rooms, Texas }
