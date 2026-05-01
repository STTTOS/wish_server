# Game Reconnect Sequence

本文描述当前「对局页断线重连」链路，重点说明 `gameRoomSinceSeq` 与 `replayEpoch` 的协作。

## 1) 正常断线重连（同一服务进程）

```mermaid
sequenceDiagram
    participant App as App (Match Page)
    participant WS as Server /game Namespace
    participant Ring as Replay Ring (in-memory)
    participant HTTP as POST /game/fetchCurrentGameState

    Note over App: 持有本地游标: sinceSeq=N, replayEpoch=E1
    App->>WS: connect(roomId, gameRoomSinceSeq=N, gameRoomReplayEpoch=E1)
    WS->>Ring: replayGameRoomSince(roomKey, N)
    Ring-->>WS: entries(seq>N), latestSeq=M

    alt entries 非空
        WS-->>App: game-room-replay {afterSeq:N, throughSeq:M, latestSeq:M, replayEpoch:E1, truncated:false, events:[...]}
        App->>App: 顺序应用 events 到 reducer
    else entries 为空且 sinceSeq < latestSeq
        WS-->>App: game-room-replay {truncated:true, replayEpoch:E1, events:[]}
        App->>HTTP: fetchCurrentGameState()
        HTTP-->>App: snapshot + latestWsSeq + latestWsReplayEpoch(E1)
        App->>App: hydrate snapshot, 更新 sinceSeq/epoch
    end
```

## 2) 服务重启后重连（epoch 不一致）

```mermaid
sequenceDiagram
    participant App as App (Match Page)
    participant WS as Server /game Namespace
    participant Ring as Replay Ring (new process)
    participant HTTP as POST /game/fetchCurrentGameState

    Note over App: 本地仍是旧游标: sinceSeq=N, replayEpoch=E1
    Note over WS: 重启后当前 epoch=E2, replay ring 已重建

    App->>WS: connect(roomId, gameRoomSinceSeq=N, gameRoomReplayEpoch=E1)
    WS->>WS: 比较 clientEpoch(E1) vs serverEpoch(E2)
    WS->>Ring: replayGameRoomSince(roomKey, N)
    Ring-->>WS: 可能为空或不连续
    WS-->>App: game-room-replay {truncated:true, replayEpoch:E2, events:[...可为空]}

    Note over App: 只要 truncated=true 就不信增量
    App->>HTTP: fetchCurrentGameState()
    HTTP-->>App: snapshot + latestWsSeq + latestWsReplayEpoch(E2)
    App->>App: 全量对齐状态, 重置 sinceSeq/epoch
    App->>WS: 后续连接携带 replayEpoch=E2
```

## 字段职责

- `gameRoomSinceSeq`: 客户端声明「已处理到的全房 WS 序号」。
- `replayEpoch`: replay 缓冲世代标识。服务进程重启后变化，用于识别“跨世代游标”。
- `truncated=true`: 增量不可可信（缓冲被挤出或 epoch 不一致），客户端必须走 HTTP 快照对齐。

## 客户端落地策略

1. 先尝试消费 `game-room-replay.events`（若有）。
2. 如果 `truncated=true`，立即 `fetchCurrentGameState`。
3. 用快照覆盖本地状态，并更新 `sinceSeq` + `replayEpoch`。
4. 后续增量继续以新游标工作。
