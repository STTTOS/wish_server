/**
 * 全局 API 结果类型（validator / facade 统一使用）。
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
