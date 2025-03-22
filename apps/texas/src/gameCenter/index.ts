import { initialGame } from 'texas-poker-core'

const rooms = new Map<string, ReturnType<typeof initialGame>>([])
export { rooms }
