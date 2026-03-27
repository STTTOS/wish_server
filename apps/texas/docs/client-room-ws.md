# 客户端房间 WebSocket 消息说明

服务端使用 **Socket.IO**，通过连接时 query 里的 **`channel`**（订阅的频道名）决定收哪些推送。

- **单个房间内推送**：`channel = 'client-room:' + 房间 id`，例如 `client-room:123`。
- **房间列表全局推送**：`channel = 'client-room-list'`，用于人数变化、房间被删等。

兼容：query 中仍支持旧参数 `roomId`（与 `channel` 同义），未传 `channel` 时会用 `roomId`。

## 1. 建立连接

### 1.1 订阅等待房间（成员进出等）

等待房间使用 **`/waiting-room` 命名空间**，URL 为 `WS_BASE + '/waiting-room'`，只需要传 `userId` 和 `roomId` 即可，服务端会把当前连接加入对应房间频道。

```js
import { io } from 'socket.io-client'

const WS_BASE = 'https://your-texas-api.com' // 与 texas 服务一致
const userId = 当前用户 id
const roomId = 当前房间 id（数字）

// 订阅等待房间
const socket = io(`${WS_BASE}/waiting-room`, {
  query: {
    userId,
    roomId
  }
})
```

### 1.2 订阅房间列表（人数变化、房间删除）

房间列表使用 **`/room-list` 命名空间**，URL 为 `WS_BASE + '/room-list'`，只需要传 `userId`。

```js
const listSocket = io(`${WS_BASE}/room-list`, {
  query: {
    userId: 当前用户 id
  }
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
      // 有人加入，data 与 /room/members 单条一致
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
