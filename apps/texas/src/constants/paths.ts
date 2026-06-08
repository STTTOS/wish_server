import { toLower } from 'ramda'

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
  '/api/web/system/maintenance/set',
  '/api/web/system/client-version/detail',
  '/api/web/system/client-version/set',
  '/api/web/system/infra/ssl/upload',
  '/api/web/system/infra/nginx/test',
  '/api/web/system/infra/nginx/apply',
  '/api/web/match/hand-poke-audit/list',
  '/api/web/match/hand-poke-audit/detail'
] as const

/**
 * 完全公开路径：无需登录态也可访问。
 */
export const PUBLIC_NO_AUTH_PATHS: ReadonlyArray<string | RegExp> = [
  /^\/api\/client\/user\/sign$/,
  /^\/api\/web\/user\/login/,
  /^\/api\/client\/game\/config$/
]

/**
 * 鉴权可选路径：有登录态则按登录态处理；无登录态也允许继续处理（如 info/logout）。
 */
export const AUTH_OPTIONAL_PATHS: ReadonlyArray<string | RegExp> = [
  /^\/api\/client\/user\/logout$/,
  /^\/api\/web\/user\/logout$/,
  /^\/api\/client\/user\/info/,
  /^\/api\/web\/user\/info/
]

export const pathMatches = (
  paths: ReadonlyArray<string | RegExp>,
  url: string
) =>
  paths.some((path) => {
    if (typeof path === 'string') return toLower(path) === toLower(url)
    return path.test(url)
  })

/**
 * 401 放行路径：公开接口 + 鉴权可选接口。
 */
export const is401BypassPath = (url: string) =>
  pathMatches(PUBLIC_NO_AUTH_PATHS, url) ||
  pathMatches(AUTH_OPTIONAL_PATHS, url)
