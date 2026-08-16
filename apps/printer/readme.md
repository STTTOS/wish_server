# Printer server

店员桌面端配套后端：小程序 COS 直传登记 → DB → Socket.IO 推送。

## 本地

```bash
cd apps/printer
# 先在 MySQL 建库：CREATE DATABASE printer;
pnpm run copy-env
# 填写 .env 中 COS_SECRET_* / SECRET_KEY / DATABASE_URL / WECHAT_MINI_*
pnpm run db:sync
pnpm run db:seed
pnpm run dev
```

- 端口默认 `7503`
- H5：`http://localhost:7503/?shop=default`
  - 顾客端源码在独立仓库 [`printer-h5`](../../../printer-h5)（React + Vite + Tailwind + Motion）
  - 构建产物部署到本应用 `public/`（与 mart 一致；history fallback → `index.html`）
- 账号：`printer` / `printer123`，`shopCode=default`

## 公开上传 API

| 路径 | 说明 |
|------|------|
| `POST /api/public/upload-token` | `wx.login` code → JWT |
| `POST /api/public/cos-sts` | JWT → 单文件 STS + `cosKey` |
| `POST /api/public/upload-complete` | 直传完成后登记并推桌面 |

顾客端仅走 **COS 直传**（小程序 `cos-wx-sdk`）。COS 密钥需具备 **STS GetFederationToken** 权限；对象前缀 `printing/{shopCode}/`。

## COS

控制台创建前缀文件夹 `printing/`，建议配置生命周期：前缀 `printing/`，**3 天后删除**（与服务端定时任务双保险）。

## Nginx

域名 `printer.wishufree.com` → 本机 `7503`，配置见 [deploy/nginx/printer.wishufree.com.conf](./deploy/nginx/printer.wishufree.com.conf)。

要点：

- `client_max_body_size` 可保持较大值；顾客大文件已直传 COS，不再经 Nginx 中转
- `/socket.io/` 开启 WebSocket（桌面端实时推送）
- 先解析 DNS A 记录到服务器，再签 SSL / reload nginx
