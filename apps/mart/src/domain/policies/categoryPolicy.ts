import type { Category } from '@prisma/mart-client'
import type { ApiResult } from '../../utils/apiResult'

import { ok, fail } from '../../utils/apiResult'
import { DEFAULT_CATEGORY_NAME } from '../../config'
import { HTTP_STATUS } from '../../constants/httpStatus'

function isDefaultCategory(category: Pick<Category, 'name'>) {
  return category.name === DEFAULT_CATEGORY_NAME
}

/**
 * Domain Policy：品类可变性规则（与持久化无关）。
 */
export const categoryPolicy = {
  isDefault: isDefaultCategory,

  assertCanRename(category: Pick<Category, 'name'>): ApiResult<null> {
    if (isDefaultCategory(category)) {
      return fail(HTTP_STATUS.BAD_REQUEST, '系统默认品类不可修改')
    }
    return ok(null)
  },

  assertCanDelete(
    category: Pick<Category, 'name'>,
    activeProductCount: number
  ): ApiResult<null> {
    if (isDefaultCategory(category)) {
      return fail(HTTP_STATUS.BAD_REQUEST, '系统默认品类不可删除')
    }
    if (activeProductCount > 0) {
      return fail(HTTP_STATUS.CONFLICT, '该品类下仍有商品，无法删除', {
        productCount: activeProductCount
      })
    }
    return ok(null)
  }
}
