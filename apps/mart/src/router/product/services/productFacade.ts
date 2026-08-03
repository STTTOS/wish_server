import type { Role } from '@prisma/mart-client'
import type { ProductView } from './productPresenter'
import type { ApiResult } from '../../../utils/apiResult'

import { withList } from '../../../utils/response'
import { ok, fail } from '../../../utils/apiResult'
import { presentProduct } from './productPresenter'
import { HTTP_STATUS } from '../../../constants/httpStatus'
import { productRepository } from '../../../repositories/productRepository'
import { validateRequiredBarcodeQuery } from '../../../utils/productBarcode'
import { categoryRepository } from '../../../repositories/categoryRepository'
import { getDefaultCategoryId } from '../../../services/ensureDefaultCategory'
import {
  mapProductCreateData,
  mapProductUpdateData
} from './productWriteMapper'
import {
  validateProductId,
  validateProductCreate,
  validateProductUpdate,
  validateProductListQuery
} from './productValidator'

async function assertCategoryExists(
  categoryId: number
): Promise<ApiResult<null>> {
  const record = await categoryRepository.findActiveById(categoryId)
  if (!record) {
    return fail(HTTP_STATUS.BAD_REQUEST, '品类不存在')
  }
  return ok(null)
}

async function assertBarcodeAvailable(
  barcode: string | null | undefined,
  excludeId?: number
): Promise<ApiResult<null>> {
  if (!barcode) return ok(null)
  const occupied = await productRepository.findAnyByBarcodeExcept(
    barcode,
    excludeId
  )
  if (!occupied) return ok(null)

  // 软删商品仍占唯一索引时释放条码，允许重新建档
  if (occupied.deletedAt) {
    await productRepository.clearBarcode(occupied.id)
    return ok(null)
  }

  return fail(HTTP_STATUS.CONFLICT, '该条码已绑定其他商品')
}

/** Application Service / Facade：编排校验 → 仓储 → 投影 */
export async function listProductsFacade(input: {
  role?: Role
  keyword?: unknown
  categoryId?: unknown
  page?: unknown
  pageSize?: unknown
  sortBy?: unknown
  sortOrder?: unknown
}) {
  const queryResult = validateProductListQuery(input)
  if (!queryResult.ok) return queryResult

  if (queryResult.data.sortBy === 'purchasePrice' && input.role !== 'admin') {
    return fail(HTTP_STATUS.FORBIDDEN, '无权按进价排序')
  }

  const { total, withoutBarcode, list } = await productRepository.listActive(
    queryResult.data
  )
  return ok(
    withList(
      list.map((item) => presentProduct(item, input.role)),
      total,
      { withoutBarcode }
    )
  )
}

export async function getProductFacade(input: {
  role?: Role
  id: unknown
}): Promise<ApiResult<ProductView>> {
  const idResult = validateProductId(input.id)
  if (!idResult.ok) return idResult

  const record = await productRepository.findActiveById(idResult.data.id)
  if (!record) {
    return fail(HTTP_STATUS.NOT_FOUND, '商品不存在')
  }

  return ok(presentProduct(record, input.role))
}

export async function getProductByBarcodeFacade(input: {
  role?: Role
  barcode: unknown
}): Promise<ApiResult<ProductView>> {
  const barcodeResult = validateRequiredBarcodeQuery(input.barcode)
  if (!barcodeResult.ok) return barcodeResult

  const record = await productRepository.findActiveByBarcode(barcodeResult.data)
  if (!record) {
    return fail(HTTP_STATUS.NOT_FOUND, '未找到该条码对应商品')
  }

  return ok(presentProduct(record, input.role))
}

export async function createProductFacade(input: {
  role: Role
  body: Record<string, unknown>
}): Promise<ApiResult<ProductView>> {
  const validated = validateProductCreate(input.body)
  if (!validated.ok) return validated

  const barcodeCheck = await assertBarcodeAvailable(validated.data.barcode)
  if (!barcodeCheck.ok) return barcodeCheck

  const categoryId = validated.data.categoryId ?? (await getDefaultCategoryId())
  const categoryResult = await assertCategoryExists(categoryId)
  if (!categoryResult.ok) return categoryResult

  const created = await productRepository.create(
    mapProductCreateData(validated.data, categoryId)
  )
  return ok(presentProduct(created, input.role))
}

export async function updateProductFacade(input: {
  role: Role
  body: Record<string, unknown>
}): Promise<ApiResult<ProductView>> {
  const validated = validateProductUpdate(input.body)
  if (!validated.ok) return validated

  const existing = await productRepository.findActiveByIdLite(validated.data.id)
  if (!existing) {
    return fail(HTTP_STATUS.NOT_FOUND, '商品不存在')
  }

  if (validated.data.barcode !== undefined) {
    const barcodeCheck = await assertBarcodeAvailable(
      validated.data.barcode,
      existing.id
    )
    if (!barcodeCheck.ok) return barcodeCheck
  }

  if (validated.data.categoryId !== undefined) {
    const categoryResult = await assertCategoryExists(validated.data.categoryId)
    if (!categoryResult.ok) return categoryResult
  }

  const updated = await productRepository.update(
    existing.id,
    mapProductUpdateData(validated.data)
  )
  return ok(presentProduct(updated, input.role))
}

export async function deleteProductFacade(input: {
  id: unknown
}): Promise<ApiResult<null>> {
  const idResult = validateProductId(input.id)
  if (!idResult.ok) return idResult

  const existing = await productRepository.findActiveByIdLite(idResult.data.id)
  if (!existing) {
    return fail(HTTP_STATUS.NOT_FOUND, '商品不存在')
  }

  await productRepository.softDelete(existing.id)
  return ok(null)
}
