/**
 * Result 对象模式：validator / facade 统一返回。
 */
export type ApiOk<T> = { ok: true; data: T }
export type ApiFail = {
  ok: false
  status: number
  message: string
  details?: unknown
}
export type ApiResult<T> = ApiOk<T> | ApiFail

export function ok<T>(data: T): ApiOk<T> {
  return { ok: true, data }
}

export function fail(
  status: number,
  message: string,
  details?: unknown
): ApiFail {
  return details === undefined
    ? { ok: false, status, message }
    : { ok: false, status, message, details }
}
