# Postmortem：房间 912 幽灵座位 / RolesAssigned 重复人

- **日期**：2026-11-07（对局），2026-11-08（排查与修复）
- **房间**：`roomId=912`（已解散 `deletedAt=2026-11-07T15:06:13.321Z`）
- **现象**：玩家主动退出后，牌桌仍像多一个人；不行动，但会拖住行动/摊牌节奏。截图顶部为 **Yizehnn**。
- **如何连生产库排查**：见 [`../prod-readonly-db-forensics.md`](../prod-readonly-db-forensics.md)

## 结论（一句话）

Yizehnn（userId=88）本人在局间被摘座且下一手未再发牌；真正故障是 Core 座位环在 `Table.joinAfter` 误改 `#last` 后，再走尾插 `join` 时撕环，导致 **`RolesAssigned` 用 `count` 多走一步、首尾同一人重复**，UI/行动序按「多一座」处理。

## 证据链（生产磁带）

数据源：生产只读库 `Match` / `MatchDomainEvent`（经 SSH 隧道）。

| 项                                 | 结果                                                                 |
| ---------------------------------- | -------------------------------------------------------------------- |
| 对局数                             | 68（match `16937`–`17004`）                                          |
| Yizehnn (88)                       | RolesAssigned 最后一手 `16991`；`16992+` 不再出现                    |
| 离场弃牌 `TurnEnded(reason=leave)` | 全房仅 1 次：`17004` / userId=36（Yang\_），**不是** 88              |
| 88 在 `16991`                      | 三次 `TurnEnded(reason=acted)`，河牌 showdown 正常结束               |
| **重复座位**                       | `16992`–`17004` 共 **13** 手 `RolesAssigned.players` 出现重复 userId |
| 例 `16992`                         | `[zz, xuan#, Yang_, 绿皮书, zz]`（5 条、4 个唯一 ID）                |
| `HoleCardsDealt`                   | 只给唯一 userId 发牌（`byUserId` 4 人）；多出的环步不会多一份洞牌键  |

磁带 payload 为双层：`{ type, payload: { ... } }`（`toPersistedDomainEventRows`）。

## 因果链路（端到端）

```text
1) 中途入座 Room.seat
   └─ 桌上已有 BB → Dealer.join(player, { insertAfter: BB })
       └─ Table.joinAfter(BB, player)
           └─ BUG: 无条件 `#last = player`
              （#last 语义应为「#head 的上家 / 环尾」；中环插入不得改写）

2) 局间有人退出（本例 Yizehnn 在 16991 结束后 between_hands 摘座）
   └─ removePlayerByIdAsSystem → Table.remove
   └─ 若被移走的是当前 BB，则环上可能暂时找不到 RoleEnum.BB

3) 再次入座 / 观战转正 Room.seat
   └─ 找不到 BB → Dealer.join(player) 走 **尾插 Table.join**
       └─ 使用错误的 `#last` 改写 next/last 指针 → 环被撕开
       └─ `#count` 增加，但从 head/button 出发的唯一圈长变短

4) 下一手 onAssignRoles
   └─ setPlayerRoles('rearrange')
       └─ getPlayersByActionSequence() = table.loop(count 步)
           └─ 多走的步数回到圈首 → RolesAssigned 首尾同一人
           └─ 客户端按 seats.length 摆座 → 「幽灵位」
           └─ 行动/人数语义与真实唯一玩家不一致 → 拖节奏 / 异常强制继续

5) dealCards
   └─ 按 count 发 N 份洞牌，但 byUserId 以 player 引用写入会覆盖重复者
   └─ 磁带表现为：RolesAssigned 重复，HoleCardsDealt 唯一键更少
```

### 本地复现（已固化为测试）

`Texas-Poker-Core/src/Dealer/tableJoinAfterLast.test.ts`：

1. 四人定庄开局 → `seat` 第五人（`joinAfter` BB）→ 再 `dealer.join` 尾插第六人
2. 修复前：`getPlayersByActionSequence` 出现 `uniq < n`（如 ids `[1,2,5,6,1,2]`）
3. 修复后：`uniq === n`

## 根因代码

文件：`Texas-Poker-Core/src/Dealer/Table.ts` → `joinAfter`

- **错误**：`this.#last = player`（中环插入也改环尾）
- **正确**：仅当插在原环尾之后（`predecessor === #last` 或 `succ === #head`）时 `#last = player`

附带：`remove` 后清空离环节点的 `next/last`，避免残留指针。

## 修复

| 仓库               | 变更                                                                                          |
| ------------------ | --------------------------------------------------------------------------------------------- |
| `Texas-Poker-Core` | `1.4.34` → **`1.4.35`**：修正 `joinAfter` `#last`；`remove` 清指针；回归测试                  |
| `wish_mono_server` | 依赖 `texas-poker-core@^1.4.35`；事后排障走 SSH/只读库直连（不保留临时 admin forensics 接口） |

## 非根因（已排除）

- Yizehnn **没有** `TurnEnded(leave)` 后仍进下一手（他本人摘座成功）
- 不是单纯的 `leavePending` 本手延后弃牌 UI（他最后一手仍在正常 acted）
- `HandEnded` / flush 漏摘 88：下一手 RolesAssigned/发牌已无 88

## 验证

- Core：`pnpm exec jest src/Dealer/tableJoinAfterLast.test.ts src/Dealer/index.test.ts`
- 生产复盘：SSH/隧道 + 只读账号查 `MatchDomainEvent`（`RolesAssigned` 是否出现重复 `userId`）

## 后续建议（非阻塞）

- `Room.seat`：BB 缺失时尾插前可断言环不变式（`count ===` 绕行唯一节点数）
- 运行时若检测到 RolesAssigned 重复 userId，打 error + engine fatal，便于线上告警
