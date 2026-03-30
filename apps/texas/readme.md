# 德州 app 后台服务

## HTTP API 响应契约（强约定）

本项目 **所有 HTTP API** 统一返回以下结构（不再在 body 中携带业务 `code`）：

### 成功

- **HTTP status**：`200`
- **body**：
  - **`ok`**: `true`
  - **`message`**: `string`
  - **`data`**: `any`（**无业务数据时固定为 `null`**）
  - **`traceId`**: `string`（用于排障与问题定位）

### 失败

- **HTTP status**：使用标准 HTTP status（如 `400/401/403/404/409/429/500/503`）
- **body**：
  - **`ok`**: `false`
  - **`message`**: `string`
  - **`details`**: `any`（可选的机器可读错误上下文；未提供时为 `null`）
  - **`traceId`**: `string`

### traceId

- 每个请求都会生成 `traceId`，并同时写入：
  - **响应头**：`x-trace-id`
  - **响应体**：`traceId`
