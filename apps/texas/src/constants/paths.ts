/**
 * 路由路径常量：用于 middleware/守卫，避免多处手写字符串路径。
 */
export const ADMIN_ONLY_PATHS = [
  '/api/web/announcement/list',
  '/api/web/announcement/validList',
  '/api/web/announcement/detail',
  '/api/web/announcement/update',
  '/api/web/announcement/create',
  '/api/web/announcement/changeStatus',
  '/api/web/announcement/delete',
  '/api/web/system/maintenance/status',
  '/api/web/system/maintenance/set'
] as const

/**
 * 401 放行路径：这些接口即使没有登录态，也允许继续处理。
 */
export const PUBLIC_401_PATHS: ReadonlyArray<string | RegExp> = [
  /^\/api\/client\/user\/sign$/,
  /^\/api\/web\/user\/login/,
  /^\/api\/client\/user\/info/,
  /^\/api\/web\/user\/info/,
  /^\/api\/client\/user\/info/,
  /^\/api\/client\/game\/config$/
]
