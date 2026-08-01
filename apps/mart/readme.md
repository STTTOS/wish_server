# mart-server

百货超市商品库存 / 价格管理后台（Koa + Prisma）。

## 角色

| 账号    | 密码       | 角色   | 能力                      |
| ------- | ---------- | ------ | ------------------------- |
| `admin` | `yuanfang` | 管理员 | 商品/品类增删改；可见进价 |
| `staff` | `yuangong` | 店员   | 只读商品/品类；不可见进价 |

> 无注册接口。可用 `pnpm db:seed` 初始化账号，或自行写入 `User` 表（密码为 SHA256 摘要）。

## 数据模型

- **一商品一品类**（`Product.categoryId`）
- 商品必填：`name`、`retailPrice`
- 默认品类：`未分类`；默认库存：`9999`
- 软删除：`deletedAt`；时间戳：`createdAt` / `updatedAt`

## API

前缀：`/api`

| 方法 | 路径                   | 权限     | 说明                                             |
| ---- | ---------------------- | -------- | ------------------------------------------------ |
| POST | `/auth/login`          | 公开     | 登录，写 cookie `token`，并返回 token            |
| POST | `/auth/logout`         | 可选登录 | 退出                                             |
| GET  | `/auth/me`             | 登录     | 当前用户                                         |
| GET  | `/category/list`       | 登录     | 品类列表                                         |
| POST | `/category/create`     | 管理员   | 创建品类                                         |
| POST | `/category/update`     | 管理员   | 编辑品类                                         |
| POST | `/category/delete`     | 管理员   | 软删除（有商品则拒绝）                           |
| GET  | `/product/list`        | 登录     | 商品分页列表                                     |
| GET  | `/product/detail`      | 登录     | 商品详情                                         |
| POST | `/product/create`      | 管理员   | 创建商品                                         |
| POST | `/product/update`      | 管理员   | 更新商品                                         |
| POST | `/product/delete`      | 管理员   | 软删除商品                                       |
| POST | `/common/upload_image` | 管理员   | 单图上传（转发 blog `/api/common/upload_image`） |

响应体与 texas 一致：`{ ok, message, data|details, traceId }`，HTTP status 即业务状态码。

图片上传依赖环境变量：`BLOG_BASE_URL`、`BLOG_SECRET_KEY`（同 blog `SECRET_KEY`）、`BLOG_ADMIN_USER_ID`。

## 分层与模式

```
Route → Facade（编排）
      → Validator / Domain Policy / Visibility Strategy
      → Repository（Prisma）
      → Presenter / Mapper（出入站投影）
```

| 模式                         | 落点                                         |
| ---------------------------- | -------------------------------------------- |
| Facade / Application Service | `router/*/services/*Facade.ts`               |
| Repository                   | `repositories/*`                             |
| Strategy                     | `domain/policies/productVisibilityPolicy.ts` |
| Domain Policy                | `domain/policies/categoryPolicy.ts`          |
| Mapper                       | `productWriteMapper.ts` + Presenter          |
| Factory                      | `ok`/`fail`、`createApp()`                   |

## 本地启动

```bash
cd apps/mart
pnpm run copy-env
# 编辑 .env 填写 DATABASE_URL
pnpm run db:sync
pnpm run db:seed
pnpm run dev
```

默认端口：`7502`
