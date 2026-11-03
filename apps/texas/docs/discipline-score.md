# 纪律分

> 产品指标：**纪律分** = 过程纪律（少犯可观察漏洞），**不是**技术强弱 / GTO / EV。

## 模型

| 层       | 权重 | 含义                                                             |
| -------- | ---- | ---------------------------------------------------------------- |
| 行动纪律 | 70%  | 自愿行动：只扣 limp/冷跟、贵跟、极端尺寸；其余干净满分；贴盲不评 |
| 习惯纪律 | 30%  | 长期频率：爱 limp、VPIP 过松、爱跟到底、松被动                   |

刻意不做：偷盲/c-bet 奖励、关位弃牌惩罚、便宜弃牌惩罚、洞牌/EV。

## 代码

- 引擎：`apps/texas/src/discipline/`
- 行动快照：`DisciplineActionSnapshot`（无公牌纹理 / SPR / aggressor）
- 用户物化：`PlayerDisciplineStat`
- 规则版本：`discipline-rules-v1`；快照 schemaVersion=2；物化 `PLAYER_DISCIPLINE_VERSION = 2`
- Backfill：`npm run backfill:discipline`（建议先 `backfill:style-stats`）

## API / UI

- 雷达轴：`discipline`（纪律分）
- 榜：`POST /api/web/style-stats/discipline-leaders`
