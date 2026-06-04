# 对局重连 / 观战：快照、WS 与「补动画」对照说明

本文说明：**仅与 Texas 当前状态一致** 与 **补放断线期间每一步动画** 的差异，以及 **客户端如何配合后端**（HTTP + `/game` WebSocket）。  
事件类型与 `game-room-replay` 字段定义见同目录 [`ws-events-reference.md`](../src/ws/ws-events-reference.md)（源码 `apps/texas/src/ws/ws-events-reference.md`）。

---

## 1. 目标对照表

| 目标                              | 含义                                                                             | 推荐后端能力                                                                                                                                                   | 客户端复杂度                                                                              |
| --------------------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| **A. 重连后界面与 Texas 一致**    | 断线/杀进程后再进桌，UI 与引擎当前状态一致即可；不要求重放断线期间的每一手动画。 | `POST …/game/fetchCurrentGameState`（快照）+ 连接 `/game` 收**之后**的 `message`。`gameRoomSinceSeq` **可不传**（等价 `0`）或传快照里的 `latestWsSeq` 作优化。 | **低**：快照初始化 + 与在线时相同的 WS 处理。                                             |
| **B. 断线期间「每一步」动画补放** | 重连后按时间顺序重播断线内的全房事件（下注、进街等），再续上实时流。             | 在 A 的基础上使用 **`auth.gameRoomSinceSeq`** + 服务端下发的 **`game-room-replay`**；`truncated` 时必须再拉快照。                                              | **高一档**：游标持久化、replay 与实时合并顺序、去重、`truncated` 恢复、与单播事件的边界。 |

---

## 2. 「只要 HTTP 快照」够不够？

- **从 Texas 组出来的快照**：在**请求到达服务端的那一刻**，就是该房间牌桌的**瞬时权威状态**，并不「比 Texas 慢半拍」。
- **仍需要 `/game` WebSocket 的原因**：快照只覆盖 **T0**；T0 之后桌况仍在变，客户端必须靠 **WS 推送**（或反复轮询 HTTP）才能持续与 Texas 一致。  
  因此：**「快照 + 连 WS 听后续」** 是基线；**不是**「快照替代 WS」。

---

## 3. 全房 WS 环形缓冲在两种目标下的角色

| 能力                                             | 目标 A                                                            | 目标 B                                                                          |
| ------------------------------------------------ | ----------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `fetchCurrentGameState` 返回的 **`latestWsSeq`** | 可选：下次连 `/game` 时带上，减少「快照与首条 WS 之间」的小缺口。 | **建议必用**：作为本地游标基准，与 `game-room-replay` 对齐。                    |
| **`game-room-replay`**                           | 可不实现客户端分支（`sinceSeq=0` 时通常无包或仅有元数据）。       | **必须**：按 `events[].seq` 顺序应用 `payload`（与同房间历史 `message` 同形）。 |
| **`truncated: true`**                            | 可忽略或按「再拉一次快照」处理。                                  | **必须**：再拉快照，并用新响应里的 `latestWsSeq` 重置游标。                     |

服务端仅对 **`broadcastGameRoom`** 发出的全房广播做缓冲（含 **`runout-hands-revealed`**、**`game-end`** 等）；**`broadcastGameToUser` / `broadcastGameEach`** 不入缓冲（例如按人手牌），断线期间的这类信息**不能**仅靠 replay 补全，仍依赖快照或既有单播策略。局间 **`lastGameEnd`** 与跑马路 **`runoutHandsRevealed`** 亦写入 HTTP 快照，避免 `truncated` 或漏 seq 时 UI 空白。

---

## 4. 客户端如何配合后端（推荐流程）

以下路径以项目中的 **`apiPrefixClient` + `/game`**、**`/room`** 为准（与 `router/game/index.ts`、`router/room/index.ts` 一致）。

### 4.1 进桌 / 重连：与 Texas 一致（目标 A）

1. **HTTP**

   - 调用 **`POST …/game/fetchCurrentGameState`**（需登录，且用户为该房 `RoomMember`，对局运行时存在）。
   - 用响应体渲染：**在坐、观战、`matchInfo`、`activePlayerInfo` 等**。
   - 局间结算 UI：响应中的 **`lastGameEnd`**（与 WS `game-end` 同形，按请求用户掩码 `settleList`）。
   - 跑马路途中重连：响应中的 **`runoutHandsRevealed`**（对手已亮底牌；不含本人）。
   - 保存响应中的 **`latestWsSeq`**（用于下一步，可选但推荐）。

2. **WebSocket `/game`**

   - 连接：`auth` 中至少包含 **`token`**、**`roomId`**（与文档 [`client-room-ws.md`](./client-room-ws.md) 一致，优先 `auth` 而非仅 `query`）。
   - 可选：`auth.gameRoomSinceSeq = latestWsSeq`（见 4.2）。
   - 监听 **`message`**：先处理服务端首包约定（如 `initial connect`），再按现有协议处理 `player-action-taken`、`game-stage-changed` 等，与未断线时相同。

3. **无需**为「一致」单独实现 replay 状态机；若收到 `game-room-replay` 且 `events` 非空，也可按 4.3 当作「小缺口补丁」处理。

### 4.2 可选优化：带游标连 WS（仍属目标 A）

**「带游标连 WS」是什么意思？**

- **游标**：客户端记住的、**全房广播**（`broadcastGameRoom`）已处理到的**单调序号**，记作 `lastSeq`（与 HTTP 返回的 **`latestWsSeq`**、WS 里每条 **`game-room-replay.events[].seq`** 同一套口径）。
- **带游标连 WS**：建 `/game` 连接时，在 **`auth.gameRoomSinceSeq`** 里告诉服务端：「**序号 ≤ `sinceSeq` 的全房广播我都算过了**」。服务端在环形缓冲里把 **`seq > sinceSeq`** 的包打成一条 **`game-room-replay`** 先发给你，再进入正常实时 `message` 流。

**比起只做 4.1，多优化了什么？**

- **4.1 不传 `gameRoomSinceSeq`（或传 `0`）**：快照时刻 T0 的界面是对的；但从 **T0 到 `/game` 真正连上** 这一小段时间里，若桌上又发生了**仅通过全房 WS** 推送的更新（例如有人行动、进街），客户端**有可能漏掉**这几条——因为既没参与当时的广播，也没要求补发。
- **4.2 带游标**：用快照里的 **`latestWsSeq`**（或你本地已持久化的 `lastSeq`）作为 **`sinceSeq`**，连上后服务端尽量用 **`game-room-replay`** 把 **T0 ～连上之间** 落在缓冲里的全房消息补上，再收后续推送，**缩小「快照与首条实时 WS」之间的缺口**。
- **仍不是万能的**：缓冲有容量、进程可能重启；若收到 **`truncated: true`**，说明中间消息已不在缓冲里，必须 **再拉一次快照**（回到 4.1 步骤 1）才能与 Texas 对齐。

**操作要点**

- 将上次成功应用的全房事件序号记为 **`lastSeq`**（首次可用快照里的 **`latestWsSeq`**）。
- 重连 `/game` 时设置 **`auth.gameRoomSinceSeq = lastSeq`**。
- 若收到 **`game-room-replay`**：在应用实时 `message` 之前，按 `seq` 升序应用 `events` 中的 `payload`，并更新 **`lastSeq = data.latestSeq`**（或逐条更新到 `throughSeq`）。
- 若 **`truncated === true`**：执行 **4.1 步骤 1** 再拉快照，并用新 **`latestWsSeq`** 重置游标。

### 4.3 目标 B：补放断线期间每一步动画

在 **4.1 + 4.2** 基础上加强：

1. **持久化 `lastSeq`**（磁盘/安全内存），与 `roomId`（及可选 `matchId`）绑定。
2. **严格顺序**：建议所有全房事件进入**同一 reducer**；先消费 `game-room-replay.events`，再消费后续实时 `message`，避免乱序双写。
3. **去重**：保证同一条业务语义不会「replay 一次 + 实时又一次」重复应用（需与后端 `seq` 语义对齐，一般 `seq` 单调即可在客户端跳过已处理序号）。
4. **回放模式**：可选「仅驱动动画、不重复改全局状态」的 dry-run，再切到 live；若直接复用 `onMessage`，注意音效、计时器、toast 等副作用是否应跳过。
5. **`truncated`**：必须走快照 + 重置游标，不可强行补动画。

---

## 5. 与「进房」HTTP 的关系

- **等待阶段进房**：`POST …/room/join`（`roomCode`）或统一入口 **`POST …/room/enter`**（见 `RoomEnterFacade`）。
- **对局已开始**：`POST …/game/join`（`roomId`）或 **`POST …/room/enter`**（`roomCode`）。
- **再**拉 **`fetchCurrentGameState`** + 连 **`/game`**，按上文配合。

---

## 6. 相关文档与源码

| 内容                                       | 位置                                                                                     |
| ------------------------------------------ | ---------------------------------------------------------------------------------------- |
| `/game` 握手、`gameRoomSinceSeq`、推荐顺序 | [`client-room-ws.md`](./client-room-ws.md) §7                                            |
| `game-room-replay` 字段与事件枚举          | [`ws-events-reference.md`](../src/ws/ws-events-reference.md)                             |
| 全房缓冲写入、销毁                         | `apps/texas/src/SockeServer/gameRoomWsReplayBuffer.ts`、`runtimeRegistry.destroyRuntime` |
| 快照接口                                   | `apps/texas/src/router/game/index.ts` → `fetchCurrentGameState`                          |

---

## 7. 小结

- **只要求「和 Texas 一致」**：**HTTP 快照一次 + `/game` 监听后续** 即可；`sinceSeq` / replay 为优化或第二阶段。
- **要「断线间每步动画」**：在上一句基础上，**必须**用好 **`gameRoomSinceSeq` + `game-room-replay` + `truncated` 时快照恢复**；复杂度主要在**客户端有序合并与去重**，通常明显高于仅「一致」方案。
