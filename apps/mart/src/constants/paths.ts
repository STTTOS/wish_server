import { toLower } from 'ramda'

/** 完全公开：无需登录 */
export const PUBLIC_NO_AUTH_PATHS: ReadonlyArray<string | RegExp> = [
  /^\/api\/auth\/login$/
]

/** 鉴权可选 */
export const AUTH_OPTIONAL_PATHS: ReadonlyArray<string | RegExp> = [
  /^\/api\/auth\/logout$/
]

/** 仅管理员 */
export const ADMIN_ONLY_PATHS: ReadonlyArray<string | RegExp> = [
  /^\/api\/product\/create$/,
  /^\/api\/product\/update$/,
  /^\/api\/product\/delete$/,
  /^\/api\/category\/create$/,
  /^\/api\/category\/update$/,
  /^\/api\/category\/delete$/
]

export const pathMatches = (
  paths: ReadonlyArray<string | RegExp>,
  url: string
) => {
  const pathname = url.split('?')[0] || url
  return paths.some((path) => {
    if (typeof path === 'string') return toLower(path) === toLower(pathname)
    return path.test(pathname)
  })
}

export const is401BypassPath = (url: string) =>
  pathMatches(PUBLIC_NO_AUTH_PATHS, url) ||
  pathMatches(AUTH_OPTIONAL_PATHS, url)

export const isAdminOnlyPath = (url: string) =>
  pathMatches(ADMIN_ONLY_PATHS, url)
