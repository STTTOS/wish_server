import type { ApiResult } from '../../../utils/apiResult'

import { HTTP_STATUS } from '../../../constants/httpStatus'

export type CategoryNameData = { name: string }

export function validateCategoryName(
  name: unknown
): ApiResult<CategoryNameData> {
  if (typeof name !== 'string') {
    return { ok: false, status: HTTP_STATUS.BAD_REQUEST, message: '参数异常' }
  }
  const trimmed = name.trim()
  if (!trimmed) {
    return {
      ok: false,
      status: HTTP_STATUS.BAD_REQUEST,
      message: '品类名称不能为空'
    }
  }
  if (trimmed.length > 64) {
    return {
      ok: false,
      status: HTTP_STATUS.BAD_REQUEST,
      message: '品类名称过长'
    }
  }
  return { ok: true, data: { name: trimmed } }
}

export function validateCategoryId(id: unknown): ApiResult<{ id: number }> {
  if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0) {
    return { ok: false, status: HTTP_STATUS.BAD_REQUEST, message: '参数异常' }
  }
  return { ok: true, data: { id } }
}
