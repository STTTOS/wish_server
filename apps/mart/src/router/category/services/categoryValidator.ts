import type { ApiResult } from '../../../utils/apiResult'

import { ok } from '../../../utils/apiResult'
import {
  validatePositiveInt,
  validateNonEmptyString
} from '../../../validation/primitives'

export type CategoryNameData = { name: string }

export function validateCategoryName(
  name: unknown
): ApiResult<CategoryNameData> {
  const result = validateNonEmptyString(name, {
    maxLength: 64,
    emptyMessage: '品类名称不能为空',
    tooLongMessage: '品类名称过长'
  })
  if (!result.ok) return result
  return ok({ name: result.data })
}

export function validateCategoryId(id: unknown): ApiResult<{ id: number }> {
  const result = validatePositiveInt(id)
  if (!result.ok) return result
  return ok({ id: result.data })
}
