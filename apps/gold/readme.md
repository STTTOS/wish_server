# Gold server（伦敦金行情）

常驻采集：约 **5s** 墙上时钟发起一轮（本轮耗时从间隔里扣，不再「结束后再等 5s」）拉 XAU 现货落 MySQL；并维护近两年日线。域名：`gold.wishufree.com` → 本机 `7504`。

现货 Tick **只认 gold-api**（失败记 PollLog，不写近似价）。`currency-api` 仍用于 **USD/CNY 汇率**（默认每 **10 分钟**重拉，失败沿用缓存）与 **历史日线补洞**，不用作 live tick 兜底。

## 为何也要日线

- 桌面端策略 / 周月季图依赖日线 OHLC，本地种子 + 客户端直拉 currency-api 慢且易断。
- 服务端 bootstrap 一次、定时增量，多端共用；当日 K 线用 tick 滚动更新 high/low/close。
- **有必要**；tick 不能替代两年日线。

## 日线权威与冻结

- **有 tick 覆盖的日子**：以 `tick:*` 滚出来的 OHLC 为准（比 currency-api 单点近似准）。
- **跨日 / 00:01 / sync 前**：若昨日是 `tick:*`，标成 `tick:final` 冻结，之后不再改 OHLC。
- **currency-api upsert**：不覆盖任何 `tick:` / `tick:final`，也不用它写「今天」。仅补没有 tick 的历史缺口。
- **日终质量**：冻结后写入 `DailyQuality`（覆盖率/断档/冻结态/与 currency 偏差），不存波段特征全量。

## 本地

```bash
# MySQL
CREATE DATABASE gold;

cd apps/gold
pnpm run copy-env
# 编辑 .env：DATABASE_URL、可选 GOLD_API_TOKEN、SERVER_PORT=7504
pnpm run db:sync   # migrate deploy + generate（生产/服务器）
# 本地要新建迁移时用：pnpm run db:migrate--dev
pnpm run dev
```

健康检查：`http://localhost:7504/api/health`

## API

统一响应：`{ ok, message, data }`。若配置了 `GOLD_API_TOKEN`，除 `/api/health` 外需：

- `Authorization: Bearer <token>`，或
- `X-Gold-Token: <token>`

| 方法 | 路径                              | 说明                                                         |
| ---- | --------------------------------- | ------------------------------------------------------------ |
| GET  | `/api/health`                     | 探活 + 采价状态 + 最新 tick 延迟                             |
| GET  | `/api/poll-logs?limit=&kind=`     | 采价失败 / skip 轻量日志（成功不写；短窗合并）               |
| GET  | `/api/spot`                       | 最新一条 tick                                                |
| GET  | `/api/ticks?since=&until=&limit=` | 区间补洞（`since` 为开区间 ms）；默认 limit 5000，最大 20000 |
| GET  | `/api/daily?from=&to=`            | 日线 OHLC（`YYYY-MM-DD`）                                    |
| POST | `/api/daily/sync`                 | 手动日线 bootstrap / 增量                                    |
| GET  | `/api/features/swing`             | 只读波段特征（Tick→H1→ 正向腿；按需计算，不落库）            |
| GET  | `/api/features/quality`           | 日终原料质量快照列表（已落库）                               |
| POST | `/api/features/quality/run`       | 手动重算某日质量（默认昨日）                                 |

### 波段特征 `GET /api/features/swing`

只读结构证据，**不**产生买卖信号、不自动改策略。算法与桌面端 `swingRanges` 对齐。**结果不落库**（原料是 Tick）。

| Query         | 默认 | 说明                        |
| ------------- | ---- | --------------------------- |
| `hours`       | 48   | 回看小时，钳制 6–168        |
| `minAmpCnyG`  | 10   | 最小振幅（元/克），下限 10  |
| `includeBars` | 0    | `1`/`true` 时附带 H1 `bars` |

`data`：`hours, minAmpCnyG, fx, asOfTs, tickCount, barCount, legs, maxAmpCnyG, bars`。

### 日终质量 `DailyQuality`（持久化）

每天一行：tick 覆盖率、断档次数/最大空洞、日线是否 `tick:final`、与 currency-api 收盘偏差。  
触发：`00:01`（冻结昨日后）+ 启动补写昨日；列表默认**现算今天**（`includeToday=1`，按已过时长估期望）；可 `POST /api/features/quality/run`。

| Query / 字段                 | 说明                                              |
| ---------------------------- | ------------------------------------------------- |
| `date` / `from`+`to`+`limit` | 查单日或区间                                      |
| `includeToday`               | 默认开；`0` 关闭今日现算                          |
| `coveragePct`                | 历史日：`tickCount/(86400s/间隔)`；今日：已过时长 |
| `partialDay`                 | 响应字段：是否为进行中的今天                      |
| `gapCount` / `maxGapMs`      | 相邻 tick ≥45s 计断档                             |
| `dailyBarFrozen`             | `source === tick:final`                           |
| `currencyCloseDiff`          | tick/日线收盘 − currency-api 单点（有则填）       |

### Tick 字段（与 london-gold `PriceQuote` 对齐）

```json
{
  "ts": 1786543294280,
  "usdOz": 4428.0,
  "usdCny": 6.7461,
  "cnyG": 960.12,
  "source": "gold-api",
  "sourceUpdatedAt": "...",
  "marketOpen": true,
  "marketClosed": false,
  "nextMarketOpenAt": null
}
```

`/api/ticks` 列表外同样带 `marketOpen` / `marketClosed` / `nextMarketOpenAt`（UTC 五 22:00→ 日 22:00）。休市时仍返回库内最新 tick，客户端应显示「休市」而非一直「刷新中」。

### 客户端后续接入建议

1. 运行中：轮询 `GET /api/spot`（或短间隔 `since=lastTs`）。
2. 打开 / 回前台：`GET /api/ticks?since=<本地最后 ts>` 补洞写入本地 `prices.jsonl`。
3. 日线：`GET /api/daily` 替换本地 currency-api bootstrap（可保留种子作离线兜底）。
4. 波段 Tab：`GET /api/features/swing` 作结构证据；失败回退本地 `prices.jsonl`。

## Nginx / 部署

1. DNS：`gold.wishufree.com` A 记录 → 与其它 `*.wishufree.com` 同 IP。
2. 申请证书，放入 nginx 证书目录（命名见 conf 注释）。
3. 拷贝 [deploy/nginx/gold.wishufree.com.conf](./deploy/nginx/gold.wishufree.com.conf) 进服务器 nginx `http {}`，`nginx -t && reload`。
4. 服务器：`CREATE DATABASE gold;`，配置 `.env`，`pnpm --filter @wishufree/gold-server build`，用与 printer 相同的 pm2 方式常驻 `dist/index.js`（`--env-file=.env`）。
5. 首次启动会自动 bootstrap 日线（可能数分钟）；也可 `POST /api/daily/sync`。

## 环境变量

见 `.local.env` 模板：`POLL_INTERVAL_MS`（默认 5000）、`FETCH_TIMEOUT_MS`（默认同间隔，且不超过间隔）、`FX_REFRESH_INTERVAL_MS`（默认 600000）、`DAILY_LOOKBACK_DAYS`（默认 730）。Tick 长期保留、不做自动清理。

## 后续未做项

见同目录 [TODO.md](./TODO.md)（完整结构特征暂缓、质量 UI 等）。
