/**
 * 全局通用的 API 结果类型（validator / usecase / facade 统一使用）。
 *
 * - 成功：`{ ok: true; data: T }`
 * - 失败：`{ ok: false; code: number; message: string }`
 */
export type ApiOk<T> = { ok: true; data: T }
export type ApiFail = { ok: false; code: number; message: string }
export type ApiResult<T> = ApiOk<T> | ApiFail

export type ApiVoidResult = ApiResult<undefined>
