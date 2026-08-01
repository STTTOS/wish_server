import type { ApiResult } from '../../../utils/apiResult'

import { withList } from '../../../utils/response'
import { product, category } from '../../../models'
import { presentCategory } from './categoryPresenter'
import { DEFAULT_CATEGORY_NAME } from '../../../config'
import { HTTP_STATUS } from '../../../constants/httpStatus'
import { validateCategoryId, validateCategoryName } from './categoryValidator'

export async function listCategoriesFacade() {
  const list = await category.findMany({
    where: { deletedAt: null },
    orderBy: [{ id: 'asc' }]
  })
  return {
    ok: true as const,
    data: withList(list.map(presentCategory), list.length)
  }
}

export async function createCategoryFacade(input: {
  name: unknown
}): Promise<ApiResult<ReturnType<typeof presentCategory>>> {
  const nameResult = validateCategoryName(input.name)
  if (!nameResult.ok) return nameResult

  const duplicated = await category.findFirst({
    where: { name: nameResult.data.name, deletedAt: null }
  })
  if (duplicated) {
    return {
      ok: false,
      status: HTTP_STATUS.CONFLICT,
      message: '品类名称已存在'
    }
  }

  const created = await category.create({
    data: { name: nameResult.data.name }
  })
  return { ok: true, data: presentCategory(created) }
}

export async function updateCategoryFacade(input: {
  id: unknown
  name: unknown
}): Promise<ApiResult<ReturnType<typeof presentCategory>>> {
  const idResult = validateCategoryId(input.id)
  if (!idResult.ok) return idResult
  const nameResult = validateCategoryName(input.name)
  if (!nameResult.ok) return nameResult

  const existing = await category.findFirst({
    where: { id: idResult.data.id, deletedAt: null }
  })
  if (!existing) {
    return { ok: false, status: HTTP_STATUS.NOT_FOUND, message: '品类不存在' }
  }

  if (existing.name === DEFAULT_CATEGORY_NAME) {
    return {
      ok: false,
      status: HTTP_STATUS.BAD_REQUEST,
      message: '系统默认品类不可修改'
    }
  }

  const duplicated = await category.findFirst({
    where: {
      name: nameResult.data.name,
      deletedAt: null,
      NOT: { id: existing.id }
    }
  })
  if (duplicated) {
    return {
      ok: false,
      status: HTTP_STATUS.CONFLICT,
      message: '品类名称已存在'
    }
  }

  const updated = await category.update({
    where: { id: existing.id },
    data: { name: nameResult.data.name }
  })
  return { ok: true, data: presentCategory(updated) }
}

export async function deleteCategoryFacade(input: {
  id: unknown
}): Promise<ApiResult<null>> {
  const idResult = validateCategoryId(input.id)
  if (!idResult.ok) return idResult

  const existing = await category.findFirst({
    where: { id: idResult.data.id, deletedAt: null }
  })
  if (!existing) {
    return { ok: false, status: HTTP_STATUS.NOT_FOUND, message: '品类不存在' }
  }

  if (existing.name === DEFAULT_CATEGORY_NAME) {
    return {
      ok: false,
      status: HTTP_STATUS.BAD_REQUEST,
      message: '系统默认品类不可删除'
    }
  }

  const productCount = await product.count({
    where: { categoryId: existing.id, deletedAt: null }
  })
  if (productCount > 0) {
    return {
      ok: false,
      status: HTTP_STATUS.CONFLICT,
      message: '该品类下仍有商品，无法删除',
      details: { productCount }
    }
  }

  await category.update({
    where: { id: existing.id },
    data: { deletedAt: new Date() }
  })
  return { ok: true, data: null }
}
