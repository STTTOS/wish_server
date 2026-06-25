type Waiter = {
  expected: Set<number>
  resolve: () => void
  timeout: NodeJS.Timeout
}

/**
 * 管理“等待游戏房间全员连接”的等待队列。
 */
export class GameConnectionWaiterStore {
  #waiters: Map<string, Waiter[]> = new Map()

  /**
   * 当房间连接用户变化时，尝试唤醒满足条件的等待任务。
   */
  notifyConnected(roomId: string, connectedUserIds: number[]) {
    const waiters = this.#waiters.get(roomId)
    if (!waiters || waiters.length === 0) return

    const connected = new Set(connectedUserIds)
    const readyWaiters = waiters.filter((w) =>
      Array.from(w.expected).every((id) => connected.has(id))
    )
    if (readyWaiters.length === 0) return

    readyWaiters.forEach((w) => {
      clearTimeout(w.timeout)
      w.resolve()
    })

    const remaining = waiters.filter((w) => !readyWaiters.includes(w))
    if (remaining.length === 0) this.#waiters.delete(roomId)
    else this.#waiters.set(roomId, remaining)
  }

  /**
   * 等待指定用户列表都连接到目标游戏房间。
   */
  waitForConnected(
    roomId: string,
    userIds: number[],
    getLatestConnected: () => number[],
    timeoutMs: number
  ) {
    const expected = new Set(userIds)

    const connected = new Set(getLatestConnected())
    const allReady = Array.from(expected).every((id) => connected.has(id))
    if (allReady) return Promise.resolve()

    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        const list = this.#waiters.get(roomId) ?? []
        const remaining = list.filter((w) => w.resolve !== resolve)
        if (remaining.length === 0) this.#waiters.delete(roomId)
        else this.#waiters.set(roomId, remaining)
        reject(
          new Error(
            `waitForGameUsersConnected timeout, roomId=${roomId}, expected=${JSON.stringify(
              userIds
            )}, connected=${JSON.stringify(getLatestConnected())}`
          )
        )
      }, timeoutMs)

      const waiter: Waiter = { expected, resolve, timeout }
      const list = this.#waiters.get(roomId) ?? []
      list.push(waiter)
      this.#waiters.set(roomId, list)
    })
  }
}
