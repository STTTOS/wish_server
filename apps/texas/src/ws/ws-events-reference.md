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
  serverNow: number      // 本条 WS 实际发出时刻（ms）；可能与引擎开始计时不一致（例如延迟推送）
  deadlineAt: number     // 与引擎一致的截止绝对时间（ms），在 onPreAction 时确定；剩余请用 deadlineAt - 本地 now
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
    isAllIn: boolean
    isFold: boolean
    handPokes: Poke[]
    /** 与 handPokes 一致：看他人且（对方弃牌 或 未摊牌）时不出现 */
    rankStrength?: number
    rankCategory?: RankCategory
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

### `player-chip-top-up`

用途：某玩家在**局间**（`between_hands`、引擎 `idle`）补码成功后，向**游戏房**内所有人广播，用于同步该玩家桌上余额与本次补入数量。

触发时机：**仅在本轮请求首次完成「引擎加钱 + DB 写入」时发一次**。若本局间已补过（HTTP 幂等静默成功）或并发下由另一请求先落库，则**不再重复推送**。

```ts
{
  roomId: number
  userId: number // 补码玩家
  afterMatchId: number // 服务端取本房「最近已结束」的 Match.id
  topUpAmount: number // 本次补入筹码，服务端取 `Room.initialChips`
  balanceAfter: number // 补码后该玩家桌上余额（引擎）
}
```

**配套 HTTP**（需登录，路径以项目 `apiPrefixClient` + `/game/chipTopUp` 为准）：

- 方法：`POST`
- Body：`{ roomId: number }`（不传 `matchId`、不传补码数量）
- 成功 `data`：`{ balanceAfter, topUpAmount, afterMatchId, alreadyApplied?: boolean }`
- 规则摘要：`afterMatchId` 为库中该房 `endedAt` 最新的一条 `Match`；须 `between_hands` 且引擎 `idle`；桌上筹码须 ≤ 起始筹码的 20%（`CHIP_TOP_UP_ELIGIBLE_RATIO`）；每 `(roomId, userId, afterMatchId)` 仅允许成功补一次。

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
  | 'player-chip-top-up'
```
