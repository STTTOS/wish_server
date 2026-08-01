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
  description: string | null
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
  description?: string | null
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

/** 可选描述：空串视为清空；最长 500 */
function validateOptionalDescription(
  value: unknown
): ApiResult<string | null | undefined> {
  if (value === undefined) return ok(undefined)
  if (value === null) return ok(null)
  if (typeof value !== 'string') {
    return fail(HTTP_STATUS.BAD_REQUEST, '描述参数异常')
  }
  const trimmed = value.trim()
  if (!trimmed) return ok(null)
  if (trimmed.length > 500) {
    return fail(HTTP_STATUS.BAD_REQUEST, '描述过长')
  }
  return ok(trimmed)
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

  const descriptionResult = validateOptionalDescription(input.description)
  if (!descriptionResult.ok) return descriptionResult

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
    description: descriptionResult.data ?? null,
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

  if (input.description !== undefined) {
    const descriptionResult = validateOptionalDescription(input.description)
    if (!descriptionResult.ok) return descriptionResult
    data.description = descriptionResult.data ?? null
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

const PRODUCT_SORT_FIELDS = [
  'retailPrice',
  'wholesalePrice',
  'purchasePrice'
] as const

export type ProductSortField = (typeof PRODUCT_SORT_FIELDS)[number]
export type ProductSortOrder = 'asc' | 'desc'

export function validateProductListQuery(input: {
  keyword?: unknown
  categoryId?: unknown
  page?: unknown
  pageSize?: unknown
  sortBy?: unknown
  sortOrder?: unknown
}): ApiResult<{
  keyword?: string
  categoryId?: number
  page: number
  pageSize: number
  sortBy?: ProductSortField
  sortOrder?: ProductSortOrder
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
    pageSize: input.pageSize,
    defaultPageSize: 20,
    maxPageSize: 200
  })
  if (!pageResult.ok) return pageResult

  let sortBy: ProductSortField | undefined
  if (
    input.sortBy !== undefined &&
    input.sortBy !== null &&
    input.sortBy !== ''
  ) {
    if (
      typeof input.sortBy !== 'string' ||
      !(PRODUCT_SORT_FIELDS as readonly string[]).includes(input.sortBy)
    ) {
      return fail(HTTP_STATUS.BAD_REQUEST, '排序字段不正确')
    }
    sortBy = input.sortBy as ProductSortField
  }

  let sortOrder: ProductSortOrder | undefined
  if (
    input.sortOrder !== undefined &&
    input.sortOrder !== null &&
    input.sortOrder !== ''
  ) {
    if (input.sortOrder !== 'asc' && input.sortOrder !== 'desc') {
      return fail(HTTP_STATUS.BAD_REQUEST, '排序方向不正确')
    }
    sortOrder = input.sortOrder
  }

  if (sortBy && !sortOrder) sortOrder = 'desc'
  if (sortOrder && !sortBy) {
    return fail(HTTP_STATUS.BAD_REQUEST, '排序参数不完整')
  }

  return ok({
    keyword,
    categoryId: categoryResult.data,
    ...pageResult.data,
    sortBy,
    sortOrder
  })
}
