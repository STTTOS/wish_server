import type { ApiResult } from '../utils/apiResult'

import { ok, fail } from '../utils/apiResult'
import { HTTP_STATUS } from '../constants/httpStatus'

/** 正整数 ID */
export function validatePositiveInt(
  value: unknown,
  message = '参数异常'
): ApiResult<number> {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    return fail(HTTP_STATUS.BAD_REQUEST, message)
  }
  return ok(value)
}

/** 查询参数中的正整数（兼容 string） */
export function parsePositiveIntQuery(
  value: unknown,
  message = '参数异常'
): ApiResult<number | undefined> {
  if (value === undefined || value === null || value === '') {
    return ok(undefined)
  }
  const raw = typeof value === 'string' ? Number(value) : value
  return validatePositiveInt(raw, message)
}

export function validateNonEmptyString(
  value: unknown,
  options?: {
    maxLength?: number
    emptyMessage?: string
    tooLongMessage?: string
  }
): ApiResult<string> {
  const emptyMessage = options?.emptyMessage ?? '不能为空'
  const tooLongMessage = options?.tooLongMessage ?? '过长'
  if (typeof value !== 'string' || !value.trim()) {
    return fail(HTTP_STATUS.BAD_REQUEST, emptyMessage)
  }
  const trimmed = value.trim()
  if (options?.maxLength !== undefined && trimmed.length > options.maxLength) {
    return fail(HTTP_STATUS.BAD_REQUEST, tooLongMessage)
  }
  return ok(trimmed)
}

export function isValidMoney(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

export function validateRequiredMoney(
  value: unknown,
  field: string
): ApiResult<number> {
  if (!isValidMoney(value)) {
    return fail(HTTP_STATUS.BAD_REQUEST, `${field}格式不正确`)
  }
  return ok(Number(value.toFixed(2)))
}

/**
 * 可选金额：
 * - undefined → 未传
 * - null → 清空
 * - number → 合法金额
 */
export function validateOptionalMoney(
  value: unknown,
  field: string
): ApiResult<number | null | undefined> {
  if (value === undefined) return ok(undefined)
  if (value === null) return ok(null)
  return validateRequiredMoney(value, field)
}

export function validateNonNegativeInt(
  value: unknown,
  message = '格式不正确'
): ApiResult<number> {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    return fail(HTTP_STATUS.BAD_REQUEST, message)
  }
  return ok(value)
}

export function validatePagination(input: {
  page?: unknown
  pageSize?: unknown
  defaultPageSize?: number
  maxPageSize?: number
}): ApiResult<{ page: number; pageSize: number }> {
  const defaultPageSize = input.defaultPageSize ?? 20
  const maxPageSize = input.maxPageSize ?? 100

  const pageRaw =
    typeof input.page === 'string' ? Number(input.page) : input.page
  const pageSizeRaw =
    typeof input.pageSize === 'string' ? Number(input.pageSize) : input.pageSize

  const page =
    pageRaw === undefined || pageRaw === null ? 1 : (pageRaw as number)
  const pageSize =
    pageSizeRaw === undefined || pageSizeRaw === null
      ? defaultPageSize
      : (pageSizeRaw as number)

  if (
    typeof page !== 'number' ||
    !Number.isInteger(page) ||
    page <= 0 ||
    typeof pageSize !== 'number' ||
    !Number.isInteger(pageSize) ||
    pageSize <= 0 ||
    pageSize > maxPageSize
  ) {
    return fail(HTTP_STATUS.BAD_REQUEST, '分页参数异常')
  }

  return ok({ page, pageSize })
}
