# Waiting Room Presence 设计说明

## 背景

等待室成员在线态存在两个典型问题：

- 新加入等待室的客户端只能收到增量事件，无法获知「加入前」已经离线的成员状态。
- 成员刚加入房间但 WS 尚未连上时，若直接按连接快照判离线，容易出现 UI 闪烁。

## 目标

- 保持服务端为在线态权威来源（data authority）。
- 连接建立后能拿到完整基线（snapshot）再接增量（delta）。
- 断线场景提供短暂宽限期（pending），降低瞬时抖动和误判。

## 协议约定

### 1) 增量事件：`waiting-room-member-presence`

```ts
{
  userId: number
  state: 'online' | 'offline' | 'pending'
  seq?: number
}
```

- `state='pending'` 表示断线后处于短暂确认窗口，暂不认定为最终离线。
- `seq` 为房间内 presence 事件单调递增序号，便于客户端做幂等和纠偏扩展。

### 2) 基线事件：`waiting-room-presence-snapshot`

```ts
{
  roomId: number
  seq: number
  members: Array<{
    userId: number
    state: 'online' | 'offline' | 'pending'
  }>
}
```

- 客户端连接 `/waiting-room` 后，服务端单播一次该事件。
- 客户端应先应用 snapshot，再继续应用后续增量 presence。

## 服务端状态机（waiting-room）

- **online**：用户在该房间存在 waiting-room 活跃连接。
- **pending**：连接断开后进入宽限期（当前实现 3s）。
- **offline**：宽限期结束仍无连接，且用户仍是该房间成员。

状态迁移：

- `online -> pending`：最后一条连接断开。
- `pending -> online`：宽限期内重连。
- `pending -> offline`：宽限期结束仍未重连。
- `offline -> online`：用户后续重连。

## 客户端渲染策略

- 维护成员名单（HTTP `/room/members`）与在线态（WS presence）解耦。
- 当前版本 `pending` 与 `online` 同展示（不显示离线态）。
- 离线仅在 `online=false` 且 `pending=false` 时展示。

## 实施范围（本次）

- 已新增 `waiting-room-presence-snapshot` 事件。
- 已为 `waiting-room-member-presence` 增加 `state/seq`。
- 已在服务端加入断线短暂宽限期（3s）逻辑。
- App 端已接入 snapshot 和 pending（pending 暂按在线展示）。
