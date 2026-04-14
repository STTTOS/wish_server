# 手牌分布审计（Web 管理端）接口说明

供 Web 对接使用。两个接口均需 **已登录的管理员**；权限由服务端 `ADMIN_ONLY_PATHS` + `customHandle403` 校验，非管理员返回 **403**。

**Base**：与现有 Web API 一致，路径前缀为 `/api/web`。

**通用响应体**（成功时）：

```json
{
  "ok": true,
  "data": { ... },
  "message": "成功",
  "traceId": "..."
}
```

失败时 `ok: false`，含 `message` / `details` 等，与其它 Web 接口一致。

---

## 1. 审计用户列表

**用途**：分页展示用户昵称、头像、有效手牌数、审计结论；支持按昵称模糊筛选。**不含**逐张牌频次（见详情接口）。

| 项           | 值                                         |
| ------------ | ------------------------------------------ |
| Method       | `POST`                                     |
| Path         | `/api/web/match/hand-poke-audit/list`      |
| Content-Type | `application/json`（与项目其它 POST 一致） |

### 请求体 `body`

| 字段       | 类型   | 必填 | 说明                                                              |
| ---------- | ------ | ---- | ----------------------------------------------------------------- |
| `current`  | number | 是   | 页码，从 **1** 开始                                               |
| `pageSize` | number | 是   | 每页条数，须 ≥ 1                                                  |
| `name`     | string | 否   | 用户昵称 **模糊匹配**（`User.name` `contains`）；不传则不过滤昵称 |

### 成功时 `data` 结构

```ts
{
  total: number // 符合筛选条件的用户总数（分页用）
  list: Array<{
    userId: number
    name: string // 游戏昵称（唯一）
    avatarKey: string // 预设头像 key，如 cartoon/default
    avatarUrl: string | null
    handCount: number // 全站有效「两手底牌」记录条数（无效 JSON/非法牌已忽略）
    auditStatus: 'insufficient_data' | 'normal' | 'abnormal'
    chiSquare: number | null
    pValue: number | null
  }>
}
```

### `auditStatus` 含义

| 值                  | 含义                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------ |
| `insufficient_data` | 有效手牌 **&lt; 150**，不做 χ² 检验；`chiSquare`、`pValue` 均为 **`null`**                       |
| `normal`            | 已检验，在 α=0.05 下 **未** 拒绝「52 种牌面均匀」假设（`pValue ≥ 0.05`）                         |
| `abnormal`          | 已检验，**拒绝**均匀假设（`pValue < 0.05`），建议技术侧结合发牌/日志排查（**不等于**已认定作弊） |

### 错误场景（示例）

- 未登录 / token 无效：**401**（由既有鉴权中间件处理）
- 非管理员：**403**，`message` 如「无权限」
- `current` / `pageSize` 非法：**400**，`message` 如「分页参数错误」

---

## 2. 审计详情（含 52 项牌面频次）

**用途**：单用户全站手牌审计结果 + 每种牌出现次数（固定 52 项，与 `texas-poker-core` 牌面编码一致，如 `h2`、`sa`）。

| 项     | 值                                      |
| ------ | --------------------------------------- |
| Method | `POST`                                  |
| Path   | `/api/web/match/hand-poke-audit/detail` |

### 请求体 `body`

| 字段     | 类型   | 必填 | 说明                    |
| -------- | ------ | ---- | ----------------------- |
| `userId` | number | 是   | 目标用户 ID，须为正整数 |

### 成功时 `data` 结构

```ts
{
  userId: number
  name: string
  avatarKey: string
  avatarUrl: string | null
  handCount: number // 有效两手记录条数（与列表同口径）
  cardCount: number // 参与统计的牌张数，恒为 handCount × 2
  auditStatus: 'insufficient_data' | 'normal' | 'abnormal'
  chiSquare: number | null
  pValue: number | null
  /** 为 true 时建议使用 pearsonResidual 做绿→黄→红渐变；false 时仅展示次数、不着色 */
  heatmapScaleEnabled: boolean
  pokeDistribution: Array<{
    poke: Poke
    count: number
    expectedCount: number
    /** Pearson 残差 (O−E)/√E；与总 χ² 同一期望 E=cardCount/52 */
    pearsonResidual: number | null
  }>
}
```

### 错误场景（示例）

- **403** 非管理员
- **400** 缺少或非法 `userId`
- **404** 用户不存在或已软删（`deletedAt` 非空）

---

## 3. 统计口径（便于产品/运营理解）

- **数据来源**：全站 `PlayerMatchRecord`，该用户所有行的 `handPokes`。
- **有效一手**：`handPokes` 为长度 **2** 的数组，两张均为合法 `Poke`（52 种之一），且 **两张不相同**。其余记录 **直接忽略**，不计入 `handCount` / `cardCount`，也不进入 χ²。
- **检验前提**：`handCount ≥ 150`（约 **300 张**底牌）才计算 `chiSquare` 与 `pValue`；否则为 `insufficient_data`。
- **检验内容**：在「每种牌边际出现概率相同」的假设下，对 52 个类别的频数做 Pearson χ² 拟合优度；**自由度 df = 51**；**p 值为上侧概率**（`P(χ²₅₁ > 观测值)`，Wilson–Hilferty 近似）。
- **显著性水平**：服务端以 **α = 0.05** 划分 `normal` / `abnormal`。

---

## 4. Web 端展示建议

### 4.1 列表行

| 字段                               | 展示建议                                                                                                                                                                              |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name` / `avatarKey` / `avatarUrl` | 与其它用户列表一致；头像可用 `avatarUrl`，无则按 `avatarKey` 映射资源。                                                                                                               |
| `handCount`                        | 文案如 **「有效底牌手数：{handCount}」**；可脚注「仅统计格式合法的两张手牌」。                                                                                                        |
| `auditStatus`                      | 用 **标签/颜色**：`insufficient_data` → 灰/信息色，「样本不足」；`normal` → 绿/成功，「未检出异常」；`abnormal` → 橙/警告，「与均匀假设差异显著（待排查）」——避免「作弊」等定性用语。 |
| `chiSquare` / `pValue`             | 当为 **`null`**（样本不足）时显示 **「—」** 或隐藏，并提示「满 150 手后显示」。有值时见下节。                                                                                         |

### 4.2 `chiSquare` 与 `pValue`（有值时）

- **pValue（主展示）**

  - 格式：保留 **3 ～ 4 位小数**，如 `0.0324`；若 `pValue < 0.0001` 可显示 **`p < 0.0001`** 避免长串 0。
  - 简短说明（可放在 tooltip）：**「在牌面均匀假设下，出现当前或更极端偏差的近似概率」**（不是「作弊概率」）。

- **chiSquare（辅展示）**

  - 格式：**1 ～ 2 位小数**即可，如 `χ² = 72.38`。
  - 建议与 **「df = 52 类牌、df = 51」** 一起写在次要位置或折叠说明，避免运营把 χ² 当成 0 ～ 100 的「健康分」。

- **与样本量一起展示**（详情页尤佳）
  - 例如：**「有效手数 {handCount} · 统计牌张 {cardCount} · χ² = … · p = …」**，避免小样本误读 p 值。

### 4.3 详情页 `pokeDistribution` 与热力着色

- **表格或柱状图**：横轴 `poke`，纵轴 `count`；可与 `expectedCount` 对照（每条相同，等于 `cardCount/52`）。

#### 何时启用绿 / 黄 / 红渐变

- 以字段 **`heatmapScaleEnabled`** 为准：与后端「满 **150** 手有效底牌」同条件（与整体 χ²/p 是否可算一致）。
- **`heatmapScaleEnabled === false`**（样本不足）：**不要**按偏差做告警色；单元格可用**中性灰**或仅数字，避免小样本下残差被误读。
- **`true`**：可按每格的 **`pearsonResidual`** 做连续或分段着色。

#### 着色依据（推荐：Pearson 残差）

- **期望**：均匀假设下，每张牌期望张数 **`expectedCount` = `cardCount` / 52**（每条 `pokeDistribution` 里已带，根级 **`cardCount`** 一致）。
- **指标**：**Pearson 残差** `r = (O − E) / √E`，即接口里的 **`pearsonResidual`**（总 χ² = Σ r²）。
- **含义（探索性）**：大样本下单格 |r| 常按 **≈2** 视作「略偏」、**≈3** 视作「很偏」（非严格阈值；52 格非独立，勿当 p 值用）。
- **颜色映射示例**（可按产品微调）：
  - `|r| ≤ 2`：浅绿（正常波动带）
  - `2 < |r| ≤ 3`：黄 / 琥珀（注意）
  - `|r| > 3`：红（明显偏离期望）
  - 也可用 **线性插值** 在绿 → 黄 → 红之间过渡（对 `|r|` 设上限 clip，如 4 ～ 5 以上饱和为红）。

#### 客户端自算（可选）

- 若只信 **`count` + `cardCount`**：`E = cardCount/52`，`r = (count - E) / sqrt(E)`，与后端一致；仍建议优先用返回的 **`pearsonResidual`**，避免浮点不一致。

- 样本不足时仍可展示 **频次表**，但 **χ²/p 为 null**、`heatmapScaleEnabled` 为 **false**，图上方提示 **「样本不足，整体检验与热力标尺未启用」**。

### 4.4 鉴权与错误

- 两接口均需带 **与其它 Web 管理接口相同的登录态**；**403** 时引导无权限账号勿入该页。

---

## 5. 路径常量（与后端对齐）

已在 `apps/texas/src/constants/paths.ts` 的 `ADMIN_ONLY_PATHS` 中登记：

- `/api/web/match/hand-poke-audit/list`
- `/api/web/match/hand-poke-audit/detail`

若网关或前端 baseURL 有前缀，在以上路径前拼接即可。
