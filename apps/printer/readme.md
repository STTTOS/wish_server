# Printer server

店员桌面端配套后端：H5 免鉴权上传 → COS `printing/` → DB → Socket.IO 推送。

## 本地

```bash
cd apps/printer
# 先在 MySQL 建库：CREATE DATABASE printer;
pnpm run copy-env
# 填写 .env 中 COS_SECRET_* / SECRET_KEY / DATABASE_URL
pnpm run db:sync
pnpm run db:seed
pnpm run dev
```

- 端口默认 `7503`
- H5：`http://localhost:7503/upload?shop=default`
  - 顾客端源码在独立仓库 [`printer-h5`](../../../printer-h5)（React + Vite + Tailwind + Motion）
  - 构建产物部署到本应用 `public/upload/`
- 账号：`printer` / `printer123`，`shopCode=default`

## COS

控制台创建前缀文件夹 `printing/`，建议配置生命周期：前缀 `printing/`，**3 天后删除**（与服务端定时任务双保险）。
