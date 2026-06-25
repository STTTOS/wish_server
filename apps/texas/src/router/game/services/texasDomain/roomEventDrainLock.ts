/**
 * 同一房间领域事件 drain 串行化，避免 HTTP `deferPacing`、思考超时、局间 hook 并发消费
 * `pendingFlowOps` 导致重复 WS / 悬挂 sleep 与状态错乱。
 */
const roomDrainTail = new Map<string, Promise<void>>()

export async function withRoomEventDrainLock<T>(
  roomKey: string,
  fn: () => Promise<T>
): Promise<T> {
  const prev = roomDrainTail.get(roomKey) ?? Promise.resolve()
  let release!: () => void
  const slot = new Promise<void>((resolve) => {
    release = resolve
  })
  const chained = prev.then(() => slot)
  roomDrainTail.set(roomKey, chained)
  await prev.catch(() => undefined)
  try {
    return await fn()
  } finally {
    release()
    if (roomDrainTail.get(roomKey) === chained) {
      roomDrainTail.delete(roomKey)
    }
  }
}

/** 房间 runtime 销毁时丢弃排队中的 drain 锁，避免阻塞后续同房新开局。 */
export function clearRoomEventDrainLock(roomKey: string): void {
  roomDrainTail.delete(roomKey)
}
