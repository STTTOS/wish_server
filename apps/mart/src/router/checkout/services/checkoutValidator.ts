import type { ApiResult } from '../../../utils/apiResult'

import { ok, fail } from '../../../utils/apiResult'
import { HTTP_STATUS } from '../../../constants/httpStatus'
import { validatePositiveInt } from '../../../validation/primitives'

export type CheckoutLineInput = {
  productId: number
  quantity: number
}

/** 校验结账行并按 productId 合并数量 */
export function validateCheckoutBody(
  body: Record<string, unknown>
): ApiResult<{ items: CheckoutLineInput[] }> {
  const rawItems = body.items
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    return fail(HTTP_STATUS.BAD_REQUEST, '结账商品不能为空')
  }

  if (rawItems.length > 200) {
    return fail(HTTP_STATUS.BAD_REQUEST, '结账商品过多')
  }

  const merged = new Map<number, number>()

  for (const raw of rawItems) {
    if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
      return fail(HTTP_STATUS.BAD_REQUEST, '结账商品参数异常')
    }
    const line = raw as Record<string, unknown>

    const idResult = validatePositiveInt(line.productId, '商品 ID 异常')
    if (!idResult.ok) return idResult

    const qtyResult = validatePositiveInt(line.quantity, '数量格式不正确')
    if (!qtyResult.ok) return qtyResult

    const prev = merged.get(idResult.data) ?? 0
    const next = prev + qtyResult.data
    if (!Number.isSafeInteger(next)) {
      return fail(HTTP_STATUS.BAD_REQUEST, '数量过大')
    }
    merged.set(idResult.data, next)
  }

  const items = [...merged.entries()].map(([productId, quantity]) => ({
    productId,
    quantity
  }))

  return ok({ items })
}
