/**
 * Result 对象模式：validator / facade / policy 统一返回。
 *
 * - 成功：`{ ok: true; data: T }`
 * - 失败：`{ ok: false; status: number; message: string; details?: unknown }`
 */
export type ApiOk<T> = { ok: true; data: T }
export type ApiFail = {
  ok: false
  status: number
  message: string
  details?: unknown
}
export type ApiResult<T> = ApiOk<T> | ApiFail
export type ApiVoidResult = ApiResult<null>

/** Factory：构造成功结果 */
export function ok<T>(data: T): ApiOk<T> {
  return { ok: true, data }
}

/** Factory：构造失败结果 */
export function fail(
  status: number,
  message: string,
  details?: unknown
): ApiFail {
  return details === undefined
    ? { ok: false, status, message }
    : { ok: false, status, message, details }
}
