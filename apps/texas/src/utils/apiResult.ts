/**
 * 全局通用的 API 结果类型（validator / usecase / facade 统一使用）。
 *
 * - 成功：`{ ok: true; data: T }`
 * - 失败：`{ ok: false; status: number; message: string; details?: unknown }`
 */
export type ApiOk<T> = { ok: true; data: T }
export type ApiFail = {
  ok: false
  /** HTTP status（唯一状态码） */
  status: number
  message: string
  /** 机器可读的错误上下文（用于客户端纠偏/埋点/排查） */
  details?: unknown
}
export type ApiResult<T> = ApiOk<T> | ApiFail

export type ApiVoidResult = ApiResult<null>
