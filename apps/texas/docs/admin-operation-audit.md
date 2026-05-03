# 管理端操作审计 / 留痕（设计备忘 · 待实施）

本文描述**为何做、记什么、存哪、如何接、谁可看**；实现时以当时代码为准，按需调整命名与路由。

## 是否有必要

- 管理端**仅有只读查询**、且无多人共管、无对外追责要求时：可暂缓。
- 一旦出现**写库操作**（改公告状态、维护开关、调余额、改权限、代客处理等），建议补上，否则纠纷时难以举证「谁、何时、改了什么」。

## 目标

1. **不可抵赖**：每条敏感操作对应一条 append-only 记录。
2. **可检索**：按操作人、时间、动作类型、资源 id 过滤。
3. **安全**：日志不落密码、token；大 JSON 可截断或只存 hash + 摘要。
4. **与排障一致**：尽量带 `traceId`（与 HTTP 响应、网关日志对齐）。

## 数据模型（建议）

新建表 `AdminOperationAudit`（名称可改），字段示例：

| 字段               | 说明                                                                               |
| ------------------ | ---------------------------------------------------------------------------------- |
| `id`               | 自增主键                                                                           |
| `actorUserId`      | 执行操作的管理员 `User.id`                                                         |
| `createdAt`        | 发生时间（建议 UTC 或全站统一时区）                                                |
| `action`           | 短枚举或字符串，如 `ANNOUNCEMENT_STATUS`、`MAINTENANCE_SET`、`USER_BALANCE_ADJUST` |
| `resourceType`     | `announcement` / `user` / `match` / `system` 等                                    |
| `resourceId`       | 可选，字符串或数字统一转字符串                                                     |
| `success`          | 是否成功                                                                           |
| `errorMessage`     | 失败时简短原因（可选）                                                             |
| `payloadBefore`    | JSON，可选；注意脱敏                                                               |
| `payloadAfter`     | JSON，可选；注意脱敏                                                               |
| `traceId`          | 可选，与请求链路一致                                                               |
| `ip` / `userAgent` | 可选，从 `ctx.request` 取                                                          |

索引：`(actorUserId, createdAt)`、`(action, createdAt)`、`(resourceType, resourceId)`。

## 写入策略（如何做）

**推荐以业务路由 / UseCase 内显式写入为主**（能拿到准确的 before/after 语义）。

1. 封装 `recordAdminAudit(ctx, input)`：
   - 从 `ctx.state.user` 取 `actorUserId`（已有 `webAuth` 可复用）。
   - 对 `payload*` 做统一脱敏（删除 `password`、`token` 等键；字符串过长截断）。
2. 在**业务写入成功之后**调用；若与 Prisma `$transaction` 同事务，需约定：**审计写失败是否回滚业务**（常见做法：业务提交成功后再写审计，审计失败打 error 日志 + 监控，避免业务被审计拖死）。
3. **不推荐**仅靠 HTTP 中间件记 body：语义弱、脱敏难、与多步业务不一致。

## 读接口与权限

- `POST /api/web/admin-audit/list`：仅 `isAdmin`（或更细「审计员」角色）；分页 + 筛选。
- 管理端 `texas-web`：菜单「操作审计」+ 表格 + 详情抽屉展示 JSON diff。

## 与现有代码的衔接

- 鉴权：`apps/texas/src/router/webAuth.ts` 中 `assertWebAdmin` / `assertWebUser`。
- 新写接口规范：**每个管理端写操作 PR 必须带一条审计**（可写进团队 checklist）。

## 实施顺序建议

1. Prisma 迁移 + `auditLog`（或上表名）model。
2. `recordAdminAudit` + 单元测试（脱敏）。
3. 从已有写接口逐个挂载（公告、系统维护等）。
4. Web 列表页 + 导出 CSV（可选）。

## 可选扩展

- **敏感读**也记一条（如导出全量用户、查看某局 `replay-composite`），视合规要求。
- **保留期**与归档任务（定时删或冷存）。
- **双写**到日志系统（ELK / Loki）用于实时告警。

---

_文档版本：随「只读运维台 / 磁带浏览」同期写入，实施前请再对一遍路由与表名。_
