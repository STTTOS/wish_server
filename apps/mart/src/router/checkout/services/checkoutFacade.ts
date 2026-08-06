import type { ApiResult } from '../../../utils/apiResult'

import { ok, fail } from '../../../utils/apiResult'
import { validateCheckoutBody } from './checkoutValidator'
import { HTTP_STATUS } from '../../../constants/httpStatus'
import {
  productRepository,
  ProductNotFoundForCheckoutError
} from '../../../repositories/productRepository'

export type CheckoutDeductedItem = {
  productId: number
  quantity: number
  /** 扣减后的库存 */
  stock: number
}

export type CheckoutResult = {
  items: CheckoutDeductedItem[]
}

/**
 * 结账扣库存：任意已登录账号（含店员）可调用。
 * 允许从 0 库存继续售卖；写入用 Math.max(stock - qty, 0)。
 */
export async function checkoutFacade(input: {
  body: Record<string, unknown>
}): Promise<ApiResult<CheckoutResult>> {
  const validated = validateCheckoutBody(input.body)
  if (!validated.ok) return validated

  try {
    const items = await productRepository.deductStockForCheckout(
      validated.data.items
    )
    return ok({ items })
  } catch (error) {
    if (error instanceof ProductNotFoundForCheckoutError) {
      return fail(HTTP_STATUS.NOT_FOUND, error.message)
    }
    throw error
  }
}
