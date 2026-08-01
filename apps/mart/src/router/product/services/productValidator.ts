import type { ApiResult } from '../../../utils/apiResult'

import { ok, fail } from '../../../utils/apiResult'
import { DEFAULT_PRODUCT_STOCK } from '../../../config'
import { HTTP_STATUS } from '../../../constants/httpStatus'
import {
  validatePagination,
  validatePositiveInt,
  parsePositiveIntQuery,
  validateOptionalMoney,
  validateRequiredMoney,
  validateNonEmptyString,
  validateNonNegativeInt
} from '../../../validation/primitives'

export type ProductCreateData = {
  name: string
  retailPrice: number
  wholesalePrice: number | null
  purchasePrice: number | null
  image: string | null
  stock: number
  categoryId: number | null
}

export type ProductUpdateData = {
  id: number
  name?: string
  retailPrice?: number
  wholesalePrice?: number | null
  purchasePrice?: number | null
  image?: string | null
  stock?: number
  categoryId?: number
}

export function validateProductId(id: unknown): ApiResult<{ id: number }> {
  const result = validatePositiveInt(id)
  if (!result.ok) return result
  return ok({ id: result.data })
}

function validateOptionalImage(
  value: unknown
): ApiResult<string | null | undefined> {
  if (value === undefined) return ok(undefined)
  if (value === null) return ok(null)
  if (typeof value !== 'string') {
    return fail(HTTP_STATUS.BAD_REQUEST, '图片参数异常')
  }
  return ok(value)
}

export function validateProductCreate(
  input: Record<string, unknown>
): ApiResult<ProductCreateData> {
  const nameResult = validateNonEmptyString(input.name, {
    maxLength: 128,
    emptyMessage: '商品名称不能为空',
    tooLongMessage: '商品名称过长'
  })
  if (!nameResult.ok) return nameResult

  const retailResult = validateRequiredMoney(input.retailPrice, '零售价')
  if (!retailResult.ok) return retailResult

  const wholesaleResult = validateOptionalMoney(input.wholesalePrice, '批发价')
  if (!wholesaleResult.ok) return wholesaleResult

  const purchaseResult = validateOptionalMoney(input.purchasePrice, '进价')
  if (!purchaseResult.ok) return purchaseResult

  const imageResult = validateOptionalImage(input.image)
  if (!imageResult.ok) return imageResult

  let stock = DEFAULT_PRODUCT_STOCK
  if (input.stock !== undefined) {
    const stockResult = validateNonNegativeInt(input.stock, '库存格式不正确')
    if (!stockResult.ok) return stockResult
    stock = stockResult.data
  }

  let categoryId: number | null = null
  if (input.categoryId !== undefined && input.categoryId !== null) {
    const categoryResult = validatePositiveInt(input.categoryId, '品类参数异常')
    if (!categoryResult.ok) return categoryResult
    categoryId = categoryResult.data
  }

  return ok({
    name: nameResult.data,
    retailPrice: retailResult.data,
    wholesalePrice: wholesaleResult.data ?? null,
    purchasePrice: purchaseResult.data ?? null,
    image: imageResult.data ?? null,
    stock,
    categoryId
  })
}

export function validateProductUpdate(
  input: Record<string, unknown>
): ApiResult<ProductUpdateData> {
  const idResult = validateProductId(input.id)
  if (!idResult.ok) return idResult

  const data: ProductUpdateData = { id: idResult.data.id }

  if (input.name !== undefined) {
    const nameResult = validateNonEmptyString(input.name, {
      maxLength: 128,
      emptyMessage: '商品名称不能为空',
      tooLongMessage: '商品名称过长'
    })
    if (!nameResult.ok) return nameResult
    data.name = nameResult.data
  }

  if (input.retailPrice !== undefined) {
    const retailResult = validateRequiredMoney(input.retailPrice, '零售价')
    if (!retailResult.ok) return retailResult
    data.retailPrice = retailResult.data
  }

  if (input.wholesalePrice !== undefined) {
    const wholesaleResult = validateOptionalMoney(
      input.wholesalePrice,
      '批发价'
    )
    if (!wholesaleResult.ok) return wholesaleResult
    data.wholesalePrice = wholesaleResult.data ?? null
  }

  if (input.purchasePrice !== undefined) {
    const purchaseResult = validateOptionalMoney(input.purchasePrice, '进价')
    if (!purchaseResult.ok) return purchaseResult
    data.purchasePrice = purchaseResult.data ?? null
  }

  if (input.image !== undefined) {
    const imageResult = validateOptionalImage(input.image)
    if (!imageResult.ok) return imageResult
    data.image = imageResult.data ?? null
  }

  if (input.stock !== undefined) {
    const stockResult = validateNonNegativeInt(input.stock, '库存格式不正确')
    if (!stockResult.ok) return stockResult
    data.stock = stockResult.data
  }

  if (input.categoryId !== undefined) {
    const categoryResult = validatePositiveInt(input.categoryId, '品类参数异常')
    if (!categoryResult.ok) return categoryResult
    data.categoryId = categoryResult.data
  }

  return ok(data)
}

export function validateProductListQuery(input: {
  keyword?: unknown
  categoryId?: unknown
  page?: unknown
  pageSize?: unknown
}): ApiResult<{
  keyword?: string
  categoryId?: number
  page: number
  pageSize: number
}> {
  let keyword: string | undefined
  if (input.keyword !== undefined && input.keyword !== null) {
    if (typeof input.keyword !== 'string') {
      return fail(HTTP_STATUS.BAD_REQUEST, '参数异常')
    }
    keyword = input.keyword.trim() || undefined
  }

  const categoryResult = parsePositiveIntQuery(input.categoryId, '品类参数异常')
  if (!categoryResult.ok) return categoryResult

  const pageResult = validatePagination({
    page: input.page,
    pageSize: input.pageSize
  })
  if (!pageResult.ok) return pageResult

  return ok({
    keyword,
    categoryId: categoryResult.data,
    ...pageResult.data
  })
}
