import type { ApiResult } from '../../../utils/apiResult'

import { DEFAULT_PRODUCT_STOCK } from '../../../config'
import { HTTP_STATUS } from '../../../constants/httpStatus'

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

function isValidMoney(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function validateOptionalMoney(
  value: unknown,
  field: string
): ApiResult<number | null | undefined> {
  if (value === undefined) return { ok: true, data: undefined }
  if (value === null) return { ok: true, data: null }
  if (!isValidMoney(value)) {
    return {
      ok: false,
      status: HTTP_STATUS.BAD_REQUEST,
      message: `${field}格式不正确`
    }
  }
  return { ok: true, data: Number(value.toFixed(2)) }
}

export function validateProductId(id: unknown): ApiResult<{ id: number }> {
  if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0) {
    return { ok: false, status: HTTP_STATUS.BAD_REQUEST, message: '参数异常' }
  }
  return { ok: true, data: { id } }
}

export function validateProductCreate(
  input: Record<string, unknown>
): ApiResult<ProductCreateData> {
  const {
    name,
    retailPrice,
    wholesalePrice,
    purchasePrice,
    image,
    stock,
    categoryId
  } = input

  if (typeof name !== 'string' || !name.trim()) {
    return {
      ok: false,
      status: HTTP_STATUS.BAD_REQUEST,
      message: '商品名称不能为空'
    }
  }
  const trimmedName = name.trim()
  if (trimmedName.length > 128) {
    return {
      ok: false,
      status: HTTP_STATUS.BAD_REQUEST,
      message: '商品名称过长'
    }
  }

  if (!isValidMoney(retailPrice)) {
    return {
      ok: false,
      status: HTTP_STATUS.BAD_REQUEST,
      message: '零售价格式不正确'
    }
  }

  const wholesaleResult = validateOptionalMoney(wholesalePrice, '批发价')
  if (!wholesaleResult.ok) return wholesaleResult

  const purchaseResult = validateOptionalMoney(purchasePrice, '进价')
  if (!purchaseResult.ok) return purchaseResult

  if (image !== undefined && image !== null && typeof image !== 'string') {
    return {
      ok: false,
      status: HTTP_STATUS.BAD_REQUEST,
      message: '图片参数异常'
    }
  }

  let resolvedStock = DEFAULT_PRODUCT_STOCK
  if (stock !== undefined) {
    if (typeof stock !== 'number' || !Number.isInteger(stock) || stock < 0) {
      return {
        ok: false,
        status: HTTP_STATUS.BAD_REQUEST,
        message: '库存格式不正确'
      }
    }
    resolvedStock = stock
  }

  let resolvedCategoryId: number | null = null
  if (categoryId !== undefined && categoryId !== null) {
    if (
      typeof categoryId !== 'number' ||
      !Number.isInteger(categoryId) ||
      categoryId <= 0
    ) {
      return {
        ok: false,
        status: HTTP_STATUS.BAD_REQUEST,
        message: '品类参数异常'
      }
    }
    resolvedCategoryId = categoryId
  }

  return {
    ok: true,
    data: {
      name: trimmedName,
      retailPrice: Number(retailPrice.toFixed(2)),
      wholesalePrice: wholesaleResult.data ?? null,
      purchasePrice: purchaseResult.data ?? null,
      image: typeof image === 'string' ? image : null,
      stock: resolvedStock,
      categoryId: resolvedCategoryId
    }
  }
}

export function validateProductUpdate(
  input: Record<string, unknown>
): ApiResult<ProductUpdateData> {
  const idResult = validateProductId(input.id)
  if (!idResult.ok) return idResult

  const data: ProductUpdateData = { id: idResult.data.id }

  if (input.name !== undefined) {
    if (typeof input.name !== 'string' || !input.name.trim()) {
      return {
        ok: false,
        status: HTTP_STATUS.BAD_REQUEST,
        message: '商品名称不能为空'
      }
    }
    const trimmedName = input.name.trim()
    if (trimmedName.length > 128) {
      return {
        ok: false,
        status: HTTP_STATUS.BAD_REQUEST,
        message: '商品名称过长'
      }
    }
    data.name = trimmedName
  }

  if (input.retailPrice !== undefined) {
    if (!isValidMoney(input.retailPrice)) {
      return {
        ok: false,
        status: HTTP_STATUS.BAD_REQUEST,
        message: '零售价格式不正确'
      }
    }
    data.retailPrice = Number(input.retailPrice.toFixed(2))
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
    if (input.image !== null && typeof input.image !== 'string') {
      return {
        ok: false,
        status: HTTP_STATUS.BAD_REQUEST,
        message: '图片参数异常'
      }
    }
    data.image = input.image as string | null
  }

  if (input.stock !== undefined) {
    if (
      typeof input.stock !== 'number' ||
      !Number.isInteger(input.stock) ||
      input.stock < 0
    ) {
      return {
        ok: false,
        status: HTTP_STATUS.BAD_REQUEST,
        message: '库存格式不正确'
      }
    }
    data.stock = input.stock
  }

  if (input.categoryId !== undefined) {
    if (
      typeof input.categoryId !== 'number' ||
      !Number.isInteger(input.categoryId) ||
      input.categoryId <= 0
    ) {
      return {
        ok: false,
        status: HTTP_STATUS.BAD_REQUEST,
        message: '品类参数异常'
      }
    }
    data.categoryId = input.categoryId
  }

  return { ok: true, data }
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
      return { ok: false, status: HTTP_STATUS.BAD_REQUEST, message: '参数异常' }
    }
    keyword = input.keyword.trim() || undefined
  }

  let categoryId: number | undefined
  if (input.categoryId !== undefined && input.categoryId !== null) {
    const raw =
      typeof input.categoryId === 'string'
        ? Number(input.categoryId)
        : input.categoryId
    if (typeof raw !== 'number' || !Number.isInteger(raw) || raw <= 0) {
      return {
        ok: false,
        status: HTTP_STATUS.BAD_REQUEST,
        message: '品类参数异常'
      }
    }
    categoryId = raw
  }

  const pageRaw =
    typeof input.page === 'string' ? Number(input.page) : input.page
  const pageSizeRaw =
    typeof input.pageSize === 'string' ? Number(input.pageSize) : input.pageSize

  const page =
    pageRaw === undefined || pageRaw === null ? 1 : (pageRaw as number)
  const pageSize =
    pageSizeRaw === undefined || pageSizeRaw === null
      ? 20
      : (pageSizeRaw as number)

  if (
    typeof page !== 'number' ||
    !Number.isInteger(page) ||
    page <= 0 ||
    typeof pageSize !== 'number' ||
    !Number.isInteger(pageSize) ||
    pageSize <= 0 ||
    pageSize > 100
  ) {
    return {
      ok: false,
      status: HTTP_STATUS.BAD_REQUEST,
      message: '分页参数异常'
    }
  }

  return { ok: true, data: { keyword, categoryId, page, pageSize } }
}
