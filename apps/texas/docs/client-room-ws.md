# 客户端房间 WebSocket 消息说明

服务端使用 **Socket.IO**，通过连接时 query 里的 **`channel`**（订阅的频道名）决定收哪些推送。

- **单个房间内推送**：`channel = 'client-room:' + 房间 id`，例如 `client-room:123`。
- **房间列表全局推送**：`channel = 'client-room-list'`，用于人数变化、房间被删等。

兼容：query 中仍支持旧参数 `roomId`（与 `channel` 同义），未传 `channel` 时会用 `roomId`。

## 1. 建立连接

### 1.0 鉴权（`/waiting-room`、`/room-list`、`/game` 相同）

连接时须携带与 HTTP 一致的 **登录 JWT**（登录接口返回的 `token`）。服务端会校验 JWT，并按 `sessionId` 与当前登录态比对（单端登录与 HTTP 一致）。

任选一种方式传 token：**`auth: { token }`**（推荐）、**`query.token`**，或握手 **`Authorization: Bearer <token>`**（视运行环境是否支持）。

### 1.1 订阅等待房间（成员进出等）

等待房间使用 **`/waiting-room` 命名空间**，URL 为 `WS_BASE + '/waiting-room'`，传 **token** 与 **`roomId`**，服务端会把当前连接加入对应房间频道。

```js
import { io } from 'socket.io-client'

const WS_BASE = 'https://your-texas-api.com' // 与 texas 服务一致
const token = 登录接口返回的 token
const roomId = 当前房间 id（数字）

// 订阅等待房间
const socket = io(`${WS_BASE}/waiting-room`, {
  auth: { token },
  query: { roomId }
})
```

### 1.2 订阅房间列表（人数变化、房间删除）

房间列表使用 **`/room-list` 命名空间**，URL 为 `WS_BASE + '/room-list'`，只需传 **token**。

```js
const listSocket = io(`${WS_BASE}/room-list`, {
  auth: { token }
})

listSocket.on('message', (payload) => {
  const { type, data } = payload
  switch (type) {
    case 'client-room-member-count-changed':
      // data: { roomId, memberCount }，更新列表中该房间的人数
      break
    case 'client-room-deleted':
      // data: { roomId }，从列表中移除该房间
      break
    case 'initial connect':
      break
    default:
      break
  }
})
```

注意：当前实现下一个 socket 连接只能加入一个命名空间下的一个房间；若既要看房间列表又要进某个房间，需要两条连接（一条连 `/room-list`，一条连 `/waiting-room`），或进入房间后只保留房间内连接、列表页再拉一次接口刷新。

## 2. 监听房间消息

服务端广播时使用事件名 **`message`**，payload 形如 `{ type: string, data: any }`。

```js
socket.on('message', (payload) => {
  const { type, data } = payload

  switch (type) {
    case 'client-room-member-joined':
      // 有人加入；在线态以 waiting-room presence 事件为准
      // { userId, name, avatarUrl, avatarKey, joinedAt, isOwner }
      setMemberList((prev) => [...prev, data])
      break

    case 'client-room-member-left':
      // 有人离开，data: { userId }
      setMemberList((prev) => prev.filter((m) => m.userId !== data.userId))
      break

    case 'initial connect':
      // 连接成功
      break

    default:
      break
  }
})
```

## 3. 时机建议

- 在调用「加入房间」接口成功、拿到房间 id 后再建立上述 WS 连接，query 传 `channel: 'client-room:' + roomId`。
- 退出房间时先调退出接口，再 `socket.disconnect()`，避免退出后还收到该房间推送。

## 4. 消息类型汇总

### 房间内（channel = `client-room:{id}`）

| type                        | 说明     | data 含义                                               |
| --------------------------- | -------- | ------------------------------------------------------- |
| `client-room-member-joined` | 有人加入 | `userId, name, avatarUrl, avatarKey, joinedAt, isOwner` |
| `client-room-member-left`   | 有人离开 | `{ userId }`，按 userId 从本地列表移除即可              |
| `client-room-owner-changed` | 房主变更 | `{ oldOwnerId, newOwnerId }`                            |

### 房间列表（channel = `client-room-list`）

| type                               | 说明           | data 含义                                     |
| ---------------------------------- | -------------- | --------------------------------------------- |
| `client-room-member-count-changed` | 某房间人数变化 | `{ roomId, memberCount }`，更新该房间显示人数 |
| `client-room-deleted`              | 某房间被删除   | `{ roomId }`，从列表中移除该房间              |

---

## 5. 命名空间 `/waiting-room`（与当前服务端实现一致）

**握手参数**：`roomId` 须让服务端能读到——优先放在 **`auth`** 里，与 `token` 同级，例如 `auth: { ...buildAuth(), roomId: String(roomId) }`。  
若使用 **同一 `Manager` 先连了其它命名空间再连 `/waiting-room`**，仅靠 `query: { roomId }` 往往**不会**进入 `handshake.query`（Socket.IO v4 复用 Engine 时 query 只保留首次 URL），会导致服务端报「parameters error」。`/game` 同样优先读 **`auth.roomId`**。

以下事件均在 **`/waiting-room`** 上通过 **`message`** 推送（payload `{ type, data }`）。文档前文的 `client-room-*` 为旧称，实现侧类型名为 `waiting-room-*`。

| type                                                                                    | 说明                                                         | data                                                                                                    |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `waiting-room-member-joined`                                                            | 有人通过 HTTP 加入房间                                       | `userId, name, avatarUrl, avatarKey, joinedAt, isOwner`（无在线字段；全量请拉 `POST .../room/members`） |
| `waiting-room-member-left`                                                              | 有人**退出房间**（HTTP quit / 踢人），DB 已无该成员          | `{ userId }`，应从本地成员列表**移除**                                                                  |
| `waiting-room-member-presence`                                                          | **仅 WS 层**：杀进程、断网、切后台断连等；**成员仍在房间内** | `{ userId, state, seq? }`：`state='pending'` 表示离线宽限期；当前 App 可按在线展示                      |
| `waiting-room-presence-snapshot`                                                        | 连接后单播的在线态基线                                       | `{ roomId, seq, members[] }`，成员项含 `userId/state`，建议先应用快照再吃增量                           |
| `waiting-room-owner-changed`                                                            | 房主变更                                                     | `{ oldOwnerId, newOwnerId }`                                                                            |
| `game-entering` / `game-entering-progress` / `game-entering-failed` / `game-entered` 等 | 开局流程                                                     | 见对局相关文档                                                                                          |

**多终端**：同一 `userId` 在**同一房间**下若仍有其它终端保持 `/waiting-room` 连接，则**不会**因其中一条断开而收到 `online: false`，避免误报。

---

## 6. App 杀进程或重开后的建议协作

**客户端**

1. **先 REST 再信 WS**：用 **`POST /api/client/room/members`**（`roomId` 必填）拉成员基础资料。房间摘要用 **`.../room/detail`**。拉完再建 `/waiting-room` WS，在线态由 `presence-snapshot` + `presence` 增量维护。
2. **再建立 `/waiting-room`**（或依赖 Socket.IO 自动重连后仍在本房间 `roomId` 上订阅）。连上后会收到 `initial connect`；其它成员会收到该用户的 `waiting-room-member-presence` 且 `state: 'online'`（若满足「该用户在本房仅这一条连接」）。
3. **UI 区分**：`member-left` → 从列表删掉；`presence` 且 `state: 'offline'` → 仅显示「离线」等，**不**删人；`state: 'online'`/`'pending'` → 取消离线态。

**服务端**

- 新连接只做现有握手（JWT + `roomId`）与 join，**不必**新增接口；上线推送由本次连接逻辑自动发出。
- 成员是否在房仍以 **DB / HTTP** 为准；WS 断开**不会**单独删成员（除非走原有「全员 waiting-room 离线 + 等待中房间」清理策略）。

---

## 7. 命名空间 `/game`：快照与 WS 补发（断线重连 / 中途观战）

更完整的**目标对照、复杂度说明与客户端配合步骤**见：**[`client-game-reconnect-snapshot.md`](./client-game-reconnect-snapshot.md)**。

**推荐顺序（摘要）**

1. **HTTP**：`POST .../game/fetchCurrentGameState`（需已是房间成员且对局存在），拿到桌面状态 + **`latestWsSeq`**。
2. **WS**：连接 `.../game`，`auth` 中带 `token`、`roomId`，以及 **`gameRoomSinceSeq: latestWsSeq`**（或本地持久化的「最后处理过的全房广播序号」）。连上后处理 `initial connect`，再处理可能下发的 **`game-room-replay`**（见 `ws-events-reference.md`）。
3. 若 `game-room-replay.truncated === true`，回到步骤 1 拉快照，并用响应里的 `latestWsSeq` 更新游标。

**说明**：环形缓冲只覆盖 **`broadcastGameRoom` 全房广播**；底牌等单播仍以 HTTP / 现有逻辑为准。
