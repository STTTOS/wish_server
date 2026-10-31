# 技术评分引擎 — 实施计划（分批）

> 依据：`decision-skill-engine-plan.md` review 决议  
> 约束：**洞牌视为脏数据，一律忽略**（不落库、不评分、删除 chart/洞牌相关技术分路径）  
> 全量 backfill：等产品通知后再做

---

## 批次

| Batch                 | 内容                                                                           | 提交单元 |
| --------------------- | ------------------------------------------------------------------------------ | -------- |
| **1 引擎纯函数**      | `decisionSkill/engine`：Snapshot 类型、P0 规则、节点分、Hand/Player 聚合、单测 | 1 commit |
| **2 Schema**          | `DecisionSkillSnapshot` + 用户聚合 `PlayerTechStat`（或扩 style 表）；迁移     | 1 commit |
| **3 投影**            | 手结束从 domain/结算投影快照（排除盲注、无洞牌字段）                           | 1 commit |
| **4 异步评分 + 接线** | 评分队列/同步钩子；雷达 skill → PlayerTech；榜用新分                           | 1 commit |
| **5 清理**            | 删除技术分用 L1–L4/chart 路径、洞牌相关计数写入与标签、死代码                  | 1 commit |

每批：**pre-commit-check → husky commit**。

---

## Batch 1 范围（本批）

- 目录：`apps/texas/src/decisionSkill/engine/`
- `DecisionSnapshot`：**不含** holePokes / holeKnown / outs / approxEquity（依赖洞牌）
- P0 规则（无洞牌）：limp、位置偷盲、彩池赔率跟弃粗判、PFR cbet/过牌、明显尺寸异常
- `scoreNode` / `aggregateHand` / `aggregatePlayer`
- 单测覆盖主路径

**不做**：Prisma、投影、API、backfill。

---

## 洞牌脏数据 → 删除/停用（Batch 5，提前登记）

- 技术分不再使用 `skillFromCounters` L1–L4
- 停止/删除：`chartOkVpipHands` / `chartKnownVpipHands` 对技术与 `leak_chart` 标签的依赖
- Snapshot 与引擎永不读洞牌
