/**
 * `/game` 命名空间「全房广播」短期环形缓冲，供断线重连 / 中途观战按序号补发。
 *
 * ## 存的是什么
 *
 * 按 **房间维度 `roomKey`（一般为 `String(roomId)`）** 各维护一条**有上限的队列**：
 * 每次 {@link SocketServer.broadcastGameRoom} 广播 replayable 事件时，
 * 将业务 payload（通常为 `{ type, data }`）记入缓冲，并分配单调递增的 **`seq`**。
 * 客户端实时流中收到的同条消息可能附带额外 `seq/replayEpoch` 元字段用于幂等，
 * 回放时仍以 `events[].seq + events[].payload` 组合为准。
 * 客户端重连 `/game` 时带 `auth.gameRoomSinceSeq`，服务端用 {@link replayGameRoomSince} 取出 **`seq > sinceSeq`**
 * 的条目打成 `game-room-replay` 下发。
 *
 * ## 不存什么
 *
 * - {@link SocketServer.broadcastGameToUser}、{@link SocketServer.broadcastGameEach} **不入缓冲**
 *   （底牌等单播仍以 HTTP 快照等为准）。
 * - 全房广播若带 **`skipReplay`**（如 `player-built-in-voice` 内置语音）同样**不入缓冲**，断线重连不补发。
 *
 * ## 关键步骤（与 SockeServer 的配合）
 *
 * 1. **写入**：`broadcastGameRoom` 内先 {@link recordGameRoomBroadcast}，再 `emit`（保证「先记后发」）。
 * 2. **读取**：`/game` `connection` 里根据握手 `gameRoomSinceSeq` 调 {@link replayGameRoomSince}，有则发 `game-room-replay`。
 * 3. **销毁**：{@link GameRuntimeRegistry.destroyRuntime} 时 {@link clearGameRoomWsReplay}，避免房间销毁后序号与脏数据残留。
 */

const DEFAULT_MAX = 400
const GAME_ROOM_REPLAY_EPOCH = `${Date.now().toString(36)}-${Math.random()
  .toString(36)
  .slice(2, 8)}`

/** 缓冲中的一条：一条全房广播对应一条记录 */
type RingEntry = {
  /** 本房全房广播单调序号；跨进程不持久，仅当前 Node 进程内有效 */
  seq: number
  /** 与当时 `emit('message', …)` 的 payload 深拷贝，避免后续对象被改导致回放失真 */
  payload: unknown
}

/**
 * 按房间隔离的环形缓冲表。
 *
 * - **Key `roomKey`**：与 Socket.IO `/game` 房间名、`gameRuntimeRegistry` 使用的 key 一致（如 `"123"`）。
 * - **Value 各字段**：
 *   - **`seq`**：该房间已分配的最大序号；下一条广播为 `seq + 1`。`0` 表示尚未记过任何全房广播。
 *   - **`ring`**：按**入队时间顺序**排列的 `{ seq, payload }[]`；**最旧在数组头部**，最新在尾部。
 *     超容量时从头部删掉最旧条目，故为「环形 / 滑动窗口」语义。
 *   - **`max`**：本房允许保留的最多条数（默认 {@link DEFAULT_MAX}）；`record` 时可按入参覆盖。
 */
const rings = new Map<string, { seq: number; ring: RingEntry[]; max: number }>()

function getOrCreate(roomKey: string, max: number) {
  let row = rings.get(roomKey)
  if (!row) {
    row = { seq: 0, ring: [], max }
    rings.set(roomKey, row)
  } else {
    row.max = max
  }
  return row
}

/** 深拷贝入缓冲，避免引擎或上层后续 mutate 同一对象影响已记录的回放 */
function clonePayload(payload: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(payload))
  } catch {
    return payload
  }
}

/**
 * 在**每次**全房广播发出前调用：分配新 `seq`、入队、必要时从**队头**丢弃最旧记录。
 *
 * @returns 本条广播对应的序号（供 HTTP `latestWsSeq` 与客户端游标对齐；与 `game-room-replay` 里 `events[].seq` 一致）
 */
export function recordGameRoomBroadcast(
  roomKey: string,
  payload: unknown,
  maxEvents = DEFAULT_MAX
): number {
  const row = getOrCreate(roomKey, maxEvents)
  row.seq += 1
  const seq = row.seq
  row.ring.push({ seq, payload: clonePayload(payload) })
  const cap = Math.max(1, row.max)
  if (row.ring.length > cap) {
    // 超过容量：删头部最旧，保留最近 cap 条，便于 `replayGameRoomSince` 仍按 seq 过滤
    row.ring.splice(0, row.ring.length - cap)
  }
  return seq
}

/** 当前房间已产生的最大 `seq`；无记录时为 `0`（与「从未广播」区分方式：客户端 sinceSeq=0 表示从头要 replay 时仅能得到缓冲内现存条目） */
export function getLatestGameRoomSeq(roomKey: string): number {
  return rings.get(roomKey)?.seq ?? 0
}

/** 当前进程内 replay 世代标识（进程重启会变化）。 */
export function getGameRoomReplayEpoch(): string {
  return GAME_ROOM_REPLAY_EPOCH
}

/**
 * 重放：返回 **`seq > sinceSeq`** 的缓冲条目（不含 `sinceSeq` 本身）。
 *
 * - 若断线过久，最早的事件已被队头挤出，则客户端 `sinceSeq` 可能仍小于当前 `getLatestGameRoomSeq`
 *   但此处返回空片段，由上层发 `game-room-replay` 且 **`truncated: true`** 并触发 HTTP 快照。
 * - `limit`：单次补发条数上限，避免单连接大包撑爆。
 */
export function replayGameRoomSince(
  roomKey: string,
  sinceSeq: number,
  limit = 250
): RingEntry[] {
  const row = rings.get(roomKey)
  if (!row || sinceSeq < 0) return []
  const out = row.ring.filter((e) => e.seq > sinceSeq)
  if (out.length <= limit) return out
  return out.slice(out.length - limit)
}

/** 房间运行时销毁时清空该房缓冲，防止复用 roomId 时序号与旧 payload 混淆 */
export function clearGameRoomWsReplay(roomKey: string) {
  rings.delete(roomKey)
}
