import { initialGame } from 'texas-poker-core'

const rooms = new Map<
  string,
  { ownerId: number; texas: ReturnType<typeof initialGame> }
>([])
export { rooms }
