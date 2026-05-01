# 开始游戏 HTTP 重构记录

本文记录从 `client/game/entring` 开始的服务端重构过程、关键设计取舍与当前架构约定。

## 1. 重构目标

- 将“超大路由函数”拆分为可维护、可测试、可演进的业务编排。
- 统一运行时状态管理，避免多处维护内存映射导致不一致。
- 强化异常与回滚能力，确保引擎异常/人数不足时状态可恢复。
- 将 WebSocket 推送从业务逻辑中剥离，降低通信细节耦合。

## 2. 阶段性改造

### 阶段 A：入口收口

- 路由层只负责参数读取与触发。
- 引入 `StartGameUseCase` 作为开始游戏统一入口。
- HTTP 立即返回，开局流程后台异步执行。

### 阶段 B：职责拆分

- `validator.ts`：开始游戏请求校验、进入中状态标记。
- `runtime.ts`：Texas 初始化、首手 Match 创建。
- `eventBinder.ts`：Texas 生命周期事件绑定。
- `rollback.ts`：对局作废、数据库回滚、内存回滚、作废通知。
- `stateMachine.ts`：房间状态迁移守卫。
- `gameWsGateway.ts`：游戏相关 WS 推送网关。

### 阶段 C：运行时统一

- 引入 `GameRuntimeRegistry` 存储房间运行时上下文。
- 清理旧的 `gameCenter` 入口，统一走 runtime registry。
- 引入 `getCurrentMatchIdWithFallback`：runtime 优先、DB 兜底。

### 阶段 D：目录与入口分层

- 引入 `services/flow`：流程编排类能力统一出口。
- 引入 `services/runtimeKit`：运行时读写与恢复策略统一出口。
- 新增 `services/README.md` 说明职责与使用约定。

### 阶段 E：SocketServer 轻量拆分

- 拆出 `GameConnectionWaiterStore`：全员连接等待队列管理。
- 拆出 `GameEnteringTracker`：进入游戏阶段连接进度跟踪。
- 拆出 `RoomCleanupManager`：waiting/game 房间离线清理策略集中管理。
- `SocketServer` 主类保留 namespace 编排与广播入口，不改外部接口。

## 3. 关键能力增强

- 实现 `game-invalidated` 事件：仅 `engine_error`，无 `players`；客户端 Toast 后回首页（人数不足关房走 `game-room-closed`）。
- 支持“回滚到开局前”：删除本手 DB 明细 + 回滚 Texas 玩家余额。
- 引入下一手倒计时运行时管理并补充关键日志（开始/取消/失败原因）。

## 4. 使用的技巧与设计模式

- **SRP（单一职责）**：按校验、运行时、事件、回滚、通信拆分模块。
- **Use Case / Facade**：`StartGameUseCase` 作为业务统一入口。
- **Registry**：`GameRuntimeRegistry` 统一房间运行时状态。
- **Gateway**：`GameWsGateway` 隔离 WS 发送细节。
- **Observer**：`eventBinder` 统一订阅 Texas 生命周期事件。
- **轻量状态机**：`stateMachine` 限制房间状态合法迁移。
- **Fallback 策略**：`getCurrentMatchIdWithFallback` 兼顾一致性与容错。
- **渐进式重构**：先兼容后收口再清理，降低一次性改动风险。

## 5. 当前架构入口

- 路由开始游戏入口：`router/game/index.ts` -> `StartGameUseCase`
- 流程能力入口：`router/game/services/flow/index.ts`
- 运行时能力入口
- Socket 清理能力入 口：`SockeServer/roomCleanupManager.ts`

## 6. 验证与质量保障

- 每轮关键改造后执行：
  - `lint`
  - `typecheck`
  - `test`
- 已建立最小测试基线：`runtimeRegistry` 读写与销毁行为测试。

## 7. 维护约定

- 新业务逻辑优先放在 `flow` / `runtimeKit` 对应层，不要回流到路由大函数。
- 运行时清理统一调用 `destroyRuntime`，避免仅 delete 导致状态残留。
- 需要当前手 `matchId` 时，优先使用 `getCurrentMatchIdWithFallback`。
- owner 仅属于 waiting-room 治理语义；in-game 流程使用 `runtimeStarterUserId`，避免把治理语义带入牌局引擎。
