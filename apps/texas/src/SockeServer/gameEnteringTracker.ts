export type EnteringTrackerItem = {
  roomIdNumber: number
  expected: Set<number>
}

/**
 * 维护“进入游戏中”阶段的房间连接跟踪状态。
 */
export class GameEnteringTracker {
  #trackers: Map<string, EnteringTrackerItem> = new Map()

  /**
   * 注册 entering 跟踪并返回 roomKey。
   */
  set(roomIdNumber: number, expectedUserIds: number[]) {
    const roomKey = String(roomIdNumber)
    this.#trackers.set(roomKey, {
      roomIdNumber,
      expected: new Set(expectedUserIds)
    })
    return roomKey
  }

  /**
   * 删除 entering 跟踪状态。
   */
  delete(roomIdNumber: number) {
    this.#trackers.delete(String(roomIdNumber))
  }

  /**
   * 获取指定房间的 entering 跟踪状态。
   */
  get(roomKey: string) {
    return this.#trackers.get(roomKey)
  }
}
