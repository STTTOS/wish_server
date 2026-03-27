# Game Services 目录约定

本目录按“流程编排”和“运行时能力”分层，避免职责扩散。

## 入口分层

- `flow/`

  - 面向“开始游戏流程”的编排与事件绑定能力
  - 对外推荐入口：`StartGameUseCase`
  - 包含：校验、状态迁移、回滚管理、WS 通知编排

- `runtimeKit/`
  - 面向“运行时读写”的统一入口
  - 对外推荐入口：`gameRuntimeRegistry`、`getCurrentMatchIdWithFallback`
  - 约定：业务层不要直接维护房间内存 map，统一通过 registry

## 文件职责

- `useCase.ts`：开始游戏主用例（HTTP 路由只调用它）
- `eventBinder.ts`：Texas 生命周期事件绑定（onError/onAction/onGameEnd 等）
- `rollback.ts`：对局作废与回滚
- `runtimeRegistry.ts`：房间运行时上下文注册中心
- `currentMatch.ts`：当前 matchId 获取策略（runtime 优先，DB 兜底）
- `runtime.ts`：Texas 实例化与首手 Match 创建
- `gameWsGateway.ts`：WS 发送网关
- `validator.ts`：开始游戏校验与 entering 标记
- `stateMachine.ts`：房间状态迁移守卫
- `types.ts`：共享类型定义

## 使用约定

- 默认优先通过 `flow/`、`runtimeKit/` 引入，避免跨文件深层依赖。
- 清理运行时统一调用 `destroyRuntime`，不要仅做 delete。
- 需要当前 matchId 时优先调用 `getCurrentMatchIdWithFallback`。
