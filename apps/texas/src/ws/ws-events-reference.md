# WS 事件参考（给 App）

基于 `apps/texas/src/ws/ws-event-types.ts` 整理。

## 消息包格式

所有 WS 消息统一结构：

```ts
type WsMessage<T extends WsEventType = WsEventType> = {
  type: T
  data: WsEventDataMap[T]
}
```

## 共享类型说明

- `Poke`: 牌面标识（来自 `texas-poker-core`）
- `RoleEnum`: 玩家角色（庄家/小盲/大盲等）
- `StageEnum`: 阶段（`pre_flop` / `flop` / `turn` / `river` 等）
- `ActionType`: 玩家行动（`check` / `fold` / `bet` / `raise` / `allIn` / `call`）
- `RankCategory`: 牌型分类

---

## 进入对局流程事件

### `game-entering`

用途：服务端通知房间成员“正在进入对局流程”。

```ts
{
  roomId: number
}
```

### `game-entering-progress`

用途：进入流程中的连接进度（用于 App 显示谁已连上 `/game`）。

```ts
{
  roomId: number
  expectedUserIds: number[]
  connectedUserIds: number[]
}
```

### `game-entered`

用途：进入成功并创建首手对局。

```ts
{
  roomId: number
  matchId: number
  userIds: number[]
}
```

### `game-entering-resolved`

用途：连接超时后的最终决策（回退等待房 or 销毁房间）。

```ts
{
  roomId: number
  outcome: 'back_waiting_room' | 'destroy_room'
  connectedUserIds: number[]
  kickedUserIds: number[]
  ownerId: number | null
}
```

---

## 对局生命周期事件

### `player-roles-assigned`

用途：本手角色分配完成（庄/盲位等）。

```ts
{
  matchId: number
  roles: Array<{
    userId: number
    role: RoleEnum
  }>
}
```

### `player-hand-dealt`

用途：给目标玩家推送其手牌（私牌）。

```ts
{
  matchId: number
  roomId: number
  handPokes: Poke[]
}
```

### `game-start`

用途：本手正式开始（含默认盲注信息）。

```ts
{
  matchId: number
  stage: StageEnum
  pool: number
  defaultBets: Array<{
    userId: number
    amount: number
    balance: number
  }>
}
```

### `player-action-required`

用途：轮到某玩家行动（包含倒计时、可用动作和限制）。

```ts
{
  matchId: number
  userId: number
  serverNow: number      // 服务端当前毫秒时间戳
  deadlineAt: number     // 行动截止毫秒时间戳
  allowedActions: ActionType[]
  restrict?: {
    min: number
    max: number
  }
}
```

### `player-action-taken`

用途：玩家已执行行动，广播给同桌玩家同步状态。

```ts
{
  matchId: number
  userId: number
  actionType: ActionType
  amount: number
  pool: number
  currentStageBetAmount: number
  balance: number
}
```

### `game-stage-changed`

用途：阶段推进（翻公共牌）。

```ts
{
  matchId: number
  stage: StageEnum
  pokesToReveal: Poke[]
}
```

### `game-end`

用途：本手结束结算。

```ts
{
  matchId: number
  settleList: Array<{
    userId: number
    balance: number
    wager: number
    rank: number
    isAllIn: boolean
    isFold: boolean
    handPokes: Poke[]
    rankCategory: RankCategory
  }>
  pokesToReveal: Poke[]
  lastActionStage: StageEnum   // 最后一轮可操作下注结束时的阶段（引擎 currentStage）
  boardThroughStage: StageEnum // 公共牌发到哪一街（引擎 endStage）
  bestRankCategory: RankCategory
  gameDuration: number   // 秒
  bestPokes: Array<Poke[]>
  totalBetAmount: number
}
```

---

## 作废与自动续局事件

### `game-invalidated`

用途：本手作废（引擎异常/人数不足），用于客户端回滚 UI。

```ts
{
  roomId: number
  matchId: number
  reason: string
  source: 'engine_error' | 'insufficient_players'
  players: Array<{
    userId: number
    role: RoleEnum | null
    balance: number
  }>
}
```

### `next-hand-countdown-started`

用途：下一手倒计时开始。

```ts
{
  roomId: number
  endsAt: number
  lockAt: number
  serverNow: number
}
```

### `next-hand-countdown-cancelled`

用途：下一手倒计时取消（如人数不足）。

```ts
{
  roomId: number
}
```

---

## 事件枚举总表

```ts
type WsEventType =
  | 'game-entering'
  | 'game-entering-progress'
  | 'game-entered'
  | 'game-entering-resolved'
  | 'game-invalidated'
  | 'next-hand-countdown-started'
  | 'next-hand-countdown-cancelled'
  | 'player-roles-assigned'
  | 'player-hand-dealt'
  | 'game-start'
  | 'player-action-required'
  | 'player-action-taken'
  | 'game-stage-changed'
  | 'game-end'
```
