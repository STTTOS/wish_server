# 昌都路牌后台（`@wishufree/roadsign-server`）

端口默认 **7505**。响应形状与 mart / gold 一致：`{ ok, data, message }`。

## 本地启动

```bash
# 先建库
# CREATE DATABASE roadsign CHARACTER SET utf8mb4;

cd apps/roadsign
pnpm run copy-env
# 编辑 .env：DATABASE_URL、COS_SECRET_*、可选 ROADSIGN_API_TOKEN
pnpm --filter @wishufree/roadsign-server db:sync
pnpm --filter @wishufree/roadsign-server dev
```

## API

| 方法 | 路径                        | 说明                                                                            |
| ---- | --------------------------- | ------------------------------------------------------------------------------- |
| GET  | `/api/health`               | 健康检查                                                                        |
| GET  | `/api/roadsign/list`        | 列表；`q`/`keyword`、`status`、`type`、`direction`、`level`、`page`、`pageSize` |
| GET  | `/api/roadsign/detail?id=`  | 详情                                                                            |
| POST | `/api/roadsign/create`      | 新建                                                                            |
| POST | `/api/roadsign/update`      | 更新（需 `id`）                                                                 |
| POST | `/api/roadsign/delete`      | 删除（body/query `id`）                                                         |
| POST | `/api/common/upload_image`  | 单张：`file` → `{ url, originalUrl, filename }`                                 |
| POST | `/api/common/upload_images` | 批量：`file` 多文件                                                             |
| GET  | `/api/common/static_map`    | 代理高德静态地图（需 `AMAP_WEB_KEY`）；透传 location/zoom/markers/paths 等      |

配置了 `ROADSIGN_API_TOKEN` 后：列表 / 详情 / health / `static_map` 可匿名；写操作与上传需 `Authorization: Bearer <token>` 或 `X-Roadsign-Token`。前端用同值 `VITE_ROADSIGN_API_TOKEN`。

Excel 卫星底图：在 `.env` 配置 **Web 服务** 类型 Key `AMAP_WEB_KEY=`（与 JS API Key 不同）。未配置时导出回退网格示意图。

部署域名：**roadsign.wishufree.com** → `localhost:7505`。nginx 模板见 `deploy/nginx/roadsign.wishufree.com.conf`。

前端（changduNav）构建后用 `npm run push-origin` 同步到本机 `apps/roadsign/public`（与 mart-web → mart/public 相同）。生产同域访问 `/api`，无需再配 `VITE_API_BASE`。

照片字段与前端一致：`signPhoto` 0~1 张，`extraPhotos` 多张，每张 `{ id, kind, url, originalUrl, name? }`。列表默认展示压缩图 `url`。
