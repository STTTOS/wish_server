# Gold server（伦敦金行情）

常驻采集：约 **5s** 拉 XAU 现货落 MySQL；并维护近两年日线。域名：`gold.wishufree.com` → 本机 `7504`。

## 为何也要日线

- 桌面端策略 / 周月季图依赖日线 OHLC，本地种子 + 客户端直拉 currency-api 慢且易断。
- 服务端 bootstrap 一次、定时增量，多端共用；当日 K 线用 tick 滚动更新 high/low/close。
- **有必要**；tick 不能替代两年日线。

## 日线权威与冻结

- **有 tick 覆盖的日子**：以 `tick:*` 滚出来的 OHLC 为准（比 currency-api 单点近似准）。
- **跨日 / 00:01 / sync 前**：若昨日是 `tick:*`，标成 `tick:final` 冻结，之后不再改 OHLC。
- **currency-api upsert**：不覆盖任何 `tick:` / `tick:final`，也不用它写「今天」。仅补没有 tick 的历史缺口。

## 本地

```bash
# MySQL
CREATE DATABASE gold;

cd apps/gold
pnpm run copy-env
# 编辑 .env：DATABASE_URL、可选 GOLD_API_TOKEN、SERVER_PORT=7504
pnpm run db:sync   # migrate + generate
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
| GET  | `/api/spot`                       | 最新一条 tick                                                |
| GET  | `/api/ticks?since=&until=&limit=` | 区间补洞（`since` 为开区间 ms）；默认 limit 5000，最大 20000 |
| GET  | `/api/daily?from=&to=`            | 日线 OHLC（`YYYY-MM-DD`）                                    |
| POST | `/api/daily/sync`                 | 手动日线 bootstrap / 增量                                    |

### Tick 字段（与 london-gold `PriceQuote` 对齐）

```json
{
  "ts": 1786543294280,
  "usdOz": 4428.0,
  "usdCny": 6.7461,
  "cnyG": 960.12,
  "source": "gold-api",
  "sourceUpdatedAt": "..."
}
```

### 客户端后续接入建议

1. 运行中：轮询 `GET /api/spot`（或短间隔 `since=lastTs`）。
2. 打开 / 回前台：`GET /api/ticks?since=<本地最后 ts>` 补洞写入本地 `prices.jsonl`。
3. 日线：`GET /api/daily` 替换本地 currency-api bootstrap（可保留种子作离线兜底）。

## Nginx / 部署

1. DNS：`gold.wishufree.com` A 记录 → 与其它 `*.wishufree.com` 同 IP。
2. 申请证书，放入 nginx 证书目录（命名见 conf 注释）。
3. 拷贝 [deploy/nginx/gold.wishufree.com.conf](./deploy/nginx/gold.wishufree.com.conf) 进服务器 nginx `http {}`，`nginx -t && reload`。
4. 服务器：`CREATE DATABASE gold;`，配置 `.env`，`pnpm --filter @wishufree/gold-server build`，用与 printer 相同的 pm2 方式常驻 `dist/index.js`（`--env-file=.env`）。
5. 首次启动会自动 bootstrap 日线（可能数分钟）；也可 `POST /api/daily/sync`。

## 环境变量

见 `.local.env` 模板：`POLL_INTERVAL_MS`、`DAILY_LOOKBACK_DAYS`（默认 730）。Tick 长期保留、不做自动清理。
