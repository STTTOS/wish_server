/**
 * 思考超时调度（单进程）
 *
 * 设计：小根堆按 deadlineAt 排序 + 仅一个 setTimeout 指向「当前全局最早到期」时刻。
 * 与固定 setInterval 扫表相比：唤醒次数由 O(每秒次数) 变为 O(到期次数)，截止更准。
 *
 * 惰性删除：同一 room 改截止或 clear 时，旧堆结点不立即从堆中剔除，弹出时用 Map
 * 对照 deadline 判断是否作废。堆中可能暂存少量陈旧结点，弹出时丢弃即可。
 */
import {
  TexasError,
  ActionTypeEnum,
  isFatalTexasErrorCode
} from 'texas-poker-core'

import { logger } from '../../../../logger'
import { gameRuntimeRegistry } from '../runtimeRegistry'
import { handleFatalTexasEngineError } from './handleFatalTexasEngineError'

// ---------------------------------------------------------------------------
// 小根堆（按 deadlineAt，其次 roomKey 保证稳定顺序）
// ---------------------------------------------------------------------------

type HeapNode = { deadlineAt: number; roomKey: string }

/** 二叉小根堆：堆顶为全局最小 deadlineAt。 */
class MinDeadlineHeap {
  private readonly a: HeapNode[] = []

  get size(): number {
    return this.a.length
  }

  isEmpty(): boolean {
    return this.a.length === 0
  }

  /** 看一眼堆顶，不弹出；空堆返回 undefined。 */
  peek(): HeapNode | undefined {
    return this.a[0]
  }

  /** 插入新结点并上浮，O(log n)。 */
  push(node: HeapNode): void {
    this.a.push(node)
    this.siftUp(this.a.length - 1)
  }

  /** 弹出最小结点并下沉，O(log n)。 */
  pop(): HeapNode | undefined {
    const n = this.a.length
    if (n === 0) return undefined
    const top = this.a[0]
    const last = this.a.pop()!
    if (n > 1) {
      this.a[0] = last
      this.siftDown(0)
    }
    return top
  }

  private cmp(i: HeapNode, j: HeapNode): number {
    const t = i.deadlineAt - j.deadlineAt
    if (t !== 0) return t
    if (i.roomKey < j.roomKey) return -1
    if (i.roomKey > j.roomKey) return 1
    return 0
  }

  /** 子结点比父小则交换，直到满足堆序。 */
  private siftUp(i: number): void {
    const { a } = this
    let idx = i
    while (idx > 0) {
      const p = (idx - 1) >> 1
      if (this.cmp(a[idx], a[p]) >= 0) break
      ;[a[idx], a[p]] = [a[p], a[idx]]
      idx = p
    }
  }

  /** 与较小子交换，直到满足堆序。 */
  private siftDown(i: number): void {
    const { a } = this
    const n = a.length
    let idx = i
    for (;;) {
      const l = idx * 2 + 1
      const r = l + 1
      let m = idx
      if (l < n && this.cmp(a[l], a[m]) < 0) m = l
      if (r < n && this.cmp(a[r], a[m]) < 0) m = r
      if (m === idx) break
      ;[a[idx], a[m]] = [a[m], a[idx]]
      idx = m
    }
  }
}

// ---------------------------------------------------------------------------
// 权威状态 + 堆 + 唯一闹钟
// ---------------------------------------------------------------------------

type PendingTurn = {
  userId: number
  deadlineAt: number
  handId: string
}

/** 每桌至多一条「当前轮到谁、何时算超时」；与 Core 的 TurnOffered 对齐。 */
const pendingByRoomKey = new Map<string, PendingTurn>()

const heap = new MinDeadlineHeap()

/** 指向「下一次应醒来处理堆」的定时器；同时最多存在一个。 */
let nextAlarm: NodeJS.Timeout | null = null

/**
 * 堆结点是否仍代表「当前有效」的待超时。
 *
 * 详细说明：
 * - 真源是 pendingByRoomKey。堆里只是按时间排序的「提醒」；同一 room 若被
 *   schedule 改期，Map 里 deadline 会变，堆里旧结点 deadline 对不上 → 作废。
 * - clear 时 Map 删掉条目，堆里旧结点 roomKey 对不上 → 作废。
 */
function isHeapNodeValid(node: HeapNode): boolean {
  const p = pendingByRoomKey.get(node.roomKey)
  return p != null && p.deadlineAt === node.deadlineAt
}

/**
 * 从堆顶开始丢弃连续作废结点（惰性删除的实现）。
 *
 * 详细说明：作废结点仍占堆顶会挡住真实最早的有效 deadline，必须在 peek /
 * 设闹钟前清掉；只清堆顶，因堆序保证作废结点若在上层会逐步被 pop 掉。
 */
function discardInvalidHeapTop(): void {
  while (!heap.isEmpty()) {
    const top = heap.peek()!
    if (isHeapNodeValid(top)) break
    heap.pop()
  }
}

/**
 * 根据当前堆顶重设唯一 setTimeout。
 *
 * 关键步骤（维护时按此核对）：
 * 1. 总是先 clearTimeout(nextAlarm)，避免旧闹钟与新的「最早到期」不一致。
 * 2. discardInvalidHeapTop：清掉堆顶陈旧结点，否则可能把闹钟设成过去或错桌。
 * 3. 若堆空：无待处理，直接返回（进程不再为超时自发唤醒）。
 * 4. delay = max(0, peek.deadlineAt - now)：避免负延迟；Node 对 0 会尽快执行。
 * 5. 闹钟回调里先把 nextAlarm 置 null，再执行 onAlarmFire（异步），避免重入时
 *    误以为仍有挂起 timer。
 */
function rescheduleNextAlarm(): void {
  if (nextAlarm != null) {
    clearTimeout(nextAlarm)
    nextAlarm = null
  }

  discardInvalidHeapTop()
  if (heap.isEmpty()) return

  const top = heap.peek()!
  const now = Date.now()
  const delay = Math.max(0, top.deadlineAt - now)

  nextAlarm = setTimeout(() => {
    nextAlarm = null
    void onAlarmFire()
  }, delay)
}

/**
 * 闹钟触发：处理所有「已经到期」的有效条目，再为剩余堆设下一闹钟。
 *
 * 关键步骤：
 * 1. 循环：反复清堆顶陈旧结点，直到空或堆顶有效。
 * 2. 若堆顶 deadlineAt > now：说明没有已到期的（例如系统休眠后醒来），
 *    只须 rescheduleNextAlarm，由新延迟对齐未来时刻。
 * 3. 否则 pop 堆顶；若结点已作废（竞态下偶发），continue。
 * 4. 从 Map 取 PendingTurn，再次核对 deadline，然后从 Map 删除，避免重复执行。
 * 5. await processOneDue：内部会 drain 领域事件，可能立刻产生新的 TurnOffered
 *    → schedulePlayerTurnTimeout → rescheduleNextAlarm；与本函数末尾的
 *    reschedule 叠加仍安全，因 schedule 会 clear 旧闹钟并重算。
 * 6. 同一毫秒多桌到期：内层 while 连续 pop 处理，无需等下一次 setTimeout。
 * 7. 最后必须 rescheduleNextAlarm：处理完一批后堆中仍有未来结点时要设新闹钟。
 */
async function onAlarmFire(): Promise<void> {
  const now = Date.now()

  for (;;) {
    discardInvalidHeapTop()
    if (heap.isEmpty()) break

    const top = heap.peek()!
    if (top.deadlineAt > now) break

    const node = heap.pop()!
    if (!isHeapNodeValid(node)) continue

    const p = pendingByRoomKey.get(node.roomKey)
    if (!p || p.deadlineAt !== node.deadlineAt) continue

    pendingByRoomKey.delete(node.roomKey)
    await processOneDue(node.roomKey, p)
  }

  rescheduleNextAlarm()
}

// ---------------------------------------------------------------------------
// 对外 API
// ---------------------------------------------------------------------------

/**
 * 登记本桌思考超时：新 TurnOffered 覆盖同 room 上一条。
 * 写入 Map 并向堆插入提醒结点，然后重算下一闹钟。
 */
export function schedulePlayerTurnTimeout(params: {
  roomKey: string
  userId: number
  deadlineAt: number
  handId: string
}): void {
  const { roomKey, userId, deadlineAt, handId } = params
  pendingByRoomKey.set(roomKey, { userId, deadlineAt, handId })
  heap.push({ deadlineAt, roomKey })
  rescheduleNextAlarm()
}

/**
 * 取消本桌待超时（玩家已行动、HandEnded、destroyRuntime 等）。
 * 只删 Map；堆中旧结点惰性失效，重算闹钟以免仍指向已取消的最早时刻。
 */
export function clearPlayerTurnTimeout(roomKey: string): void {
  pendingByRoomKey.delete(roomKey)
  rescheduleNextAlarm()
}

/**
 * 到期时执行：校验仍轮到该玩家、本手未换，再 CheckDueToTimeout / FoldDueToTimeout。
 */
async function processOneDue(roomKey: string, p: PendingTurn): Promise<void> {
  const texas = gameRuntimeRegistry.getTexas(roomKey)
  if (!texas) return

  const active = texas.controller.activePlayer
  if (!active || active.getUserInfo().id !== p.userId) return

  if (texas.controller.currentHandId !== p.handId) return

  const canCheck = active.getAllowedActions().includes(ActionTypeEnum.CHECK)
  const cmd = canCheck
    ? ({ type: 'CheckDueToTimeout', playerId: p.userId } as const)
    : ({ type: 'FoldDueToTimeout', playerId: p.userId } as const)

  let roomId: number
  try {
    roomId = gameRuntimeRegistry.getOrThrow(roomKey).roomId
  } catch {
    return
  }

  try {
    await texas.dispatchCommand(cmd)
    const { drainAndInterpretTexas } = await import('./drainTexasDomainEvents')
    const { getTexasEventContextForRoom } = await import('./texasEventContext')
    await drainAndInterpretTexas(getTexasEventContextForRoom(roomKey))
  } catch (e: unknown) {
    if (e instanceof TexasError && isFatalTexasErrorCode(e.code)) {
      await handleFatalTexasEngineError({
        error: e,
        roomId,
        roomKey,
        getRuntime: () => gameRuntimeRegistry.getOrThrow(roomKey)
      })
      return
    }
    logger.warn(
      `[turn-timeout] dispatch failed roomKey=${roomKey} cmd=${cmd.type}`,
      e
    )
  }
}
