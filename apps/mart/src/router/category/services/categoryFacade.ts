import type { ApiResult } from '../../../utils/apiResult'

import { withList } from '../../../utils/response'
import { ok, fail } from '../../../utils/apiResult'
import { presentCategory } from './categoryPresenter'
import { HTTP_STATUS } from '../../../constants/httpStatus'
import { categoryPolicy } from '../../../domain/policies/categoryPolicy'
import { productRepository } from '../../../repositories/productRepository'
import { categoryRepository } from '../../../repositories/categoryRepository'
import { validateCategoryId, validateCategoryName } from './categoryValidator'

/** Application Service / Facade：编排校验 → 策略 → 仓储 → 投影 */
export async function listCategoriesFacade() {
  const list = await categoryRepository.listActive()
  return ok(withList(list.map(presentCategory), list.length))
}

export async function createCategoryFacade(input: {
  name: unknown
}): Promise<ApiResult<ReturnType<typeof presentCategory>>> {
  const nameResult = validateCategoryName(input.name)
  if (!nameResult.ok) return nameResult

  const duplicated = await categoryRepository.findActiveByName(
    nameResult.data.name
  )
  if (duplicated) {
    return fail(HTTP_STATUS.CONFLICT, '品类名称已存在')
  }

  const created = await categoryRepository.create(nameResult.data.name)
  return ok(presentCategory(created))
}

export async function updateCategoryFacade(input: {
  id: unknown
  name: unknown
}): Promise<ApiResult<ReturnType<typeof presentCategory>>> {
  const idResult = validateCategoryId(input.id)
  if (!idResult.ok) return idResult
  const nameResult = validateCategoryName(input.name)
  if (!nameResult.ok) return nameResult

  const existing = await categoryRepository.findActiveById(idResult.data.id)
  if (!existing) {
    return fail(HTTP_STATUS.NOT_FOUND, '品类不存在')
  }

  const renamePolicy = categoryPolicy.assertCanRename(existing)
  if (!renamePolicy.ok) return renamePolicy

  const duplicated = await categoryRepository.findActiveByName(
    nameResult.data.name,
    existing.id
  )
  if (duplicated) {
    return fail(HTTP_STATUS.CONFLICT, '品类名称已存在')
  }

  const updated = await categoryRepository.updateName(
    existing.id,
    nameResult.data.name
  )
  return ok(presentCategory(updated))
}

export async function deleteCategoryFacade(input: {
  id: unknown
}): Promise<ApiResult<null>> {
  const idResult = validateCategoryId(input.id)
  if (!idResult.ok) return idResult

  const existing = await categoryRepository.findActiveById(idResult.data.id)
  if (!existing) {
    return fail(HTTP_STATUS.NOT_FOUND, '品类不存在')
  }

  const productCount = await productRepository.countActiveByCategory(
    existing.id
  )
  const deletePolicy = categoryPolicy.assertCanDelete(existing, productCount)
  if (!deletePolicy.ok) return deletePolicy

  await categoryRepository.softDelete(existing.id)
  return ok(null)
}
