---
name: pre-commit-review
description: >-
  Runs a structured pre-commit / pre-PR checklist for wish_mono_server
  (apps/texas, texas-ws-contract, Prisma, Socket.IO). Focus on cohesion,
  data authority, SRP, minimal change, WS/HTTP contracts, and bug risk.
  Use when the user asks for 提交前检查, pre-commit review, PR 自检,
  代码质量检查, or merge readiness checks for this server monorepo.
  For texas-poker-core domain changes use Texas-Poker-Core/.cursor/skills/pre-commit-check.
---

# Pre-commit review（wish_mono_server）

在 **commit / push / 提 PR 前**，对本次改动做一次快速、可执行的审查。输出应：**结论（通过 / 需改）+ 按严重度列出项 + 必要时给出具体文件与改法**，避免泛泛而谈。

本仓库栈：**pnpm monorepo · Koa · Prisma · Socket.IO · `packages/texas-ws-contract` · `apps/texas`**。规则引擎真值在 **texas-poker-core**；本库负责接入、持久化、WS/HTTP 契约与房间 runtime。

## 1. 高内聚 & 低耦合

- **内聚**：同一业务决策是否集中在 service / useCase（如 `drainTexasDomainEvents`、`currentGameStateSnapshot`），而不是 router + SockeServer + runtime 各改一半？
- **耦合**：是否把 Core 规则 / 结算逻辑塞进 HTTP/WS 层？WS payload 类型是否只从 `@wishufree/texas-ws-contract` 引入？
- **边界**：`SockeServer` 管连接与广播；`gameWsGateway` / domain drain 管业务推送；Prisma 访问留在 models / services，避免在 socket handler 里堆查询。

## 2. 数据权威性

- **SSOT**：局内事实以 Core + runtime（`gameRuntimeRegistry`）为准；HTTP `fetchCurrentGameState` / WS 事件应对齐同一读模型，避免「快照一套、直播一套」。
- **契约**：新增 / 变更 WS 字段先改 `packages/texas-ws-contract`，再改 emit 与客户端消费；不要在服务端私自加未入 contract 的字段当长期契约。
- **持久化**：Prisma 写入字段与读回路径是否一致（如 `settlementRuns.seats`、match record）；迁移 / schema 变更是否成对出现。
- **可见性**：私牌、settle 掩码、他人手牌是否按 viewer 过滤（单播 vs 广播、replay 缓冲是否误带私牌）。

## 3. 单一职责原则

- router：鉴权、参数校验、调用 service、`response.*`
- service / useCase：编排与领域适配
- SockeServer：连接生命周期、房间 channel、replay 缓冲
- 函数是否只做一件事；纯计算与 IO 边界清楚

## 4. 避免过度重构

- **diff 是否紧贴需求**：无关格式化、大范围搬迁、顺手重命名标需拆出
- 已有 gateway / snapshot / drain 抽象时 **优先复用**，勿平行再造一套推送路径

## 5. Bug 风险（服务端硬性）

- **入参**：`roomId` / `userId` / `matchId` 非法、未参与房间却读敏感数据（403）、空数组
- **WS**：单播事件（如 `player-hand-dealt`）是否进了全房 replay？重连 / 切后台后是否有补发或 HTTP 快照兜底？
- **竞态**：disconnect grace、多端同用户、`waitForAllGameConnections` 超时
- **错误路径**：`response.error` 类型码是否稳定；失败是否留下半更新 runtime
- **密钥**：勿提交 `.env`、凭证、真实用户牌面到日志（手牌应 redact）

## 6. 契约与测试

- 改 `texas-ws-contract`：确认 `apps/texas` emit 形状与客户端 `file:` 依赖仍对齐
- 有纯函数 / 口径逻辑（累计曲线、掩码、聚合）：尽量补 `*.test.ts`
- 建议命令（按改动范围）：
  - `pnpm --filter texas lint`（或根 `pnpm lint`）
  - 相关单测：`cd apps/texas && npx tsx --test path/to/*.test.ts` 或 package `test`
  - 涉及 build 契约时：`pnpm --filter texas build`

## 执行方式

1. `git status` / `git diff` 确认范围（无 `.env`、无无关大文件）
2. 按上列清单扫 diff，标出 **必须修 / 建议修 / 可选**
3. 与同目录现有文件对齐命名、import、错误码风格
4. 输出结论；有阻塞先修再 commit

## 输出格式（推荐）

1. **摘要**：通过与否，一句话
2. **问题列表**：序号 + 严重度 + 位置（文件:行或符号）+ 说明 + 建议
3. **验证**：已跑 / 建议跑的命令与结果
