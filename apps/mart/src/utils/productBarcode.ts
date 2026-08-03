import type { ApiResult } from './apiResult'

import { ok, fail } from './apiResult'
import { HTTP_STATUS } from '../constants/httpStatus'

const BARCODE_MAX_LENGTH = 64
/** 常见一维/商品码：数字为主，兼容少量字母（Code128） */
const BARCODE_PATTERN = /^[0-9A-Za-z\-_.]+$/

export function normalizeBarcode(raw: string): string {
  return raw.trim().replace(/\s+/g, '')
}

/**
 * 可选条码：undefined 表示不改；null/空串表示清空；否则规范化字符串。
 */
export function validateOptionalBarcode(
  value: unknown
): ApiResult<string | null | undefined> {
  if (value === undefined) return ok(undefined)
  if (value === null) return ok(null)
  if (typeof value !== 'string') {
    return fail(HTTP_STATUS.BAD_REQUEST, '条码参数异常')
  }
  const normalized = normalizeBarcode(value)
  if (!normalized) return ok(null)
  if (normalized.length > BARCODE_MAX_LENGTH) {
    return fail(HTTP_STATUS.BAD_REQUEST, '条码过长')
  }
  if (!BARCODE_PATTERN.test(normalized)) {
    return fail(HTTP_STATUS.BAD_REQUEST, '条码格式不正确')
  }
  return ok(normalized)
}

export function validateRequiredBarcodeQuery(
  value: unknown
): ApiResult<string> {
  if (typeof value !== 'string') {
    return fail(HTTP_STATUS.BAD_REQUEST, '请提供条码')
  }
  const normalized = normalizeBarcode(value)
  if (!normalized) {
    return fail(HTTP_STATUS.BAD_REQUEST, '请提供条码')
  }
  if (normalized.length > BARCODE_MAX_LENGTH) {
    return fail(HTTP_STATUS.BAD_REQUEST, '条码过长')
  }
  return ok(normalized)
}
