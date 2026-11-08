# 生产库只读排查手册（SSH 隧道 + MySQL）

用于事后复盘（幽灵座、离场弃牌、RolesAssigned 等），**不**依赖临时 admin HTTP 接口。  
密钥与连接串只放本机 ignore 文件，禁止提交 git、禁止贴到公开聊天。

相关案例：[`postmortems/2026-11-07-room-912-ghost-duplicate-seats.md`](./postmortems/2026-11-07-room-912-ghost-duplicate-seats.md)

---

## 0. 原则

| 项       | 建议                                                                                   |
| -------- | -------------------------------------------------------------------------------------- |
| 账号     | 单独只读用户（如 `texas_ro`），不要用业务 `DATABASE_URL` 的写账号日常排查              |
| 网络     | 优先 **SSH 本地隧道**；避免对公网永久放开 `3306`                                       |
| 凭证存放 | `apps/texas/.env.prod.ro`（已在 `.gitignore`）                                         |
| 查数工具 | 本机 Homebrew MySQL 9 可能不支持 `mysql_native_password` → 用 **Prisma / mysql2** 更稳 |

---

## 1. 在生产 MySQL 建只读账号

SSH 登录云主机后，用有建用户权限的账号进入 MySQL（常见为 `sudo mysql` 或应用配置里的管理员账号；`mysql -u root -p` 若 1045，多半是 root 走 socket 或密码与 `DATABASE_URL` 用户不一致）。

```sql
CREATE USER 'texas_ro'@'localhost' IDENTIFIED BY '换成你的强密码';
GRANT SELECT ON texas.* TO 'texas_ro'@'localhost';
FLUSH PRIVILEGES;
```

说明：

- 隧道场景下，MySQL 看到的来源是本机，宿主用 `'localhost'`（或 `'127.0.0.1'`）即可。
- 若必须从跳板机其它主机直连，再改为对应 IP，**慎用 `'%'`**。
- 库名以实际为准（当前为 `texas`）。
- 密码里有 `@ # / %` 等字符时，写入 URL 需做 **百分号编码**。

验证（在云主机上）：

```bash
mysql -u texas_ro -p texas -e "SELECT COUNT(*) AS rooms FROM Room;"
```

---

## 2. 本机建立 SSH 隧道

在 **本机 Mac** 另开终端（保持不关）：

```bash
ssh -N -L 13306:127.0.0.1:3306 root@<云主机公网IP或域名>
```

含义：本机 `127.0.0.1:13306` → 云主机上的 `127.0.0.1:3306`（MySQL）。

检查隧道是否起来：

```bash
nc -z -w 2 127.0.0.1 13306 && echo port_open
# 或
lsof -iTCP:13306 -sTCP:LISTEN
```

常见问题：

| 现象                            | 处理                                                                |
| ------------------------------- | ------------------------------------------------------------------- |
| `Can't connect ... 13306 (61)`  | 隧道未开或已断，重跑 `ssh -N -L ...`                                |
| 公网直连 `3306` 超时            | 安全组未放行；继续用隧道，不要强行开公网 MySQL                      |
| `ERROR 1045` 用 root + 业务密码 | `DATABASE_URL` 里往往不是 root；用 `texas_ro` 或 URL 中的真实用户名 |

---

## 3. 本机写入只读连接串

文件（勿提交）：

`apps/texas/.env.prod.ro`

```bash
# 生产只读排查用（勿提交）
DATABASE_URL=mysql://texas_ro:密码@127.0.0.1:13306/texas
```

仓库已 ignore：`apps/texas/.gitignore` 与根 `.gitignore` 中的 `.env.prod.ro`。

---

## 4. 连通性测试（推荐 Prisma）

在 `apps/texas` 目录（有 `@prisma/texas-client`）：

```bash
cd apps/texas
node <<'NODE'
const fs = require('fs')
const raw = fs.readFileSync('.env.prod.ro', 'utf8')
const m = raw.match(/^DATABASE_URL=(.+)$/m)
if (!m || !m[1].trim()) throw new Error('DATABASE_URL empty')
process.env.DATABASE_URL = m[1].trim()
const { PrismaClient } = require('@prisma/texas-client')
const prisma = new PrismaClient()
const j = (v) =>
  JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? x.toString() : x), 2)
;(async () => {
  const meta = await prisma.$queryRawUnsafe(
    'SELECT 1 AS ok, DATABASE() AS db, USER() AS user'
  )
  console.log(j({ meta }))
  await prisma.$disconnect()
})().catch(async (e) => {
  console.error(e.message)
  try {
    await prisma.$disconnect()
  } catch {}
  process.exit(1)
})
NODE
```

期望看到类似：`user: texas_ro@localhost`，`db: texas`。

---

## 5. 常用排查查询（示例）

以下用 Prisma 脚本或 `mysql` 客户端均可；**生产磁带 `MatchDomainEvent.payload` 多为双层** `{ type, payload: { ... } }`，解析时要取内层。

### 5.1 房间概况

```sql
SELECT id, activeCode, gameStatus, ownerId, deletedAt, createdAt
FROM Room WHERE id = ?;

SELECT rm.userId, u.name, rm.joinedAt
FROM RoomMember rm
JOIN User u ON u.id = rm.userId
WHERE rm.roomId = ?
ORDER BY rm.joinedAt;

SELECT id, startedAt, endedAt, totalBetAmount
FROM `Match`
WHERE roomId = ?
ORDER BY id DESC
LIMIT 20;
```

### 5.2 离场弃牌（真实信号）

Core 落磁带的是 **`TurnEnded` + `reason = 'leave'`**，不是命令名 `FoldDueToLeave`。

关注内层：`payload.payload.reason` / `payload.payload.userId`（若已是扁平结构则直接 `payload.reason`）。

### 5.3 幽灵座 / 环损坏（RolesAssigned 重复 userId）

对某一 `roomId`，取出各手 `RolesAssigned`，看 `players` 数组是否 **条数 > 去重 userId 数**。  
房间 912 案例：`16992`–`17004` 连续出现首尾同一人。

### 5.4 某玩家是否还进下一手

对比相邻两手 `RolesAssigned` 的 `userId` 集合：  
上一手有、下一手无 → 已摘环（或未再入座）；  
上一手已 `leave` fold 且下一手仍在 → flush/摘环异常嫌疑。

---

## 6. 安全收尾

排查结束后建议：

1. 关掉本机 SSH 隧道终端（Ctrl+C）。
2. 不必长期保留公网 `3306` 安全组规则。
3. 可选：轮换 `texas_ro` 密码；不用时 `DROP USER`（下次再建）。
4. 确认 `.env.prod.ro` 未被 `git status` 跟踪。

```bash
git check-ignore -v apps/texas/.env.prod.ro
```

---

## 7. 与「临时 HTTP 排查接口」的关系

曾短暂加过 `runtime-debug` / `leave-forensics` admin 接口，在可稳定走 **SSH + 只读库** 后已删除。  
**运行时内存环**（`leavePending`、当前 Core 座位）仍只能看 **当时托管该房的进程**；房间已解散则只能依赖磁带与 DB，无法回放当时内存。
