import type { Role } from '@prisma/mart-client'
import type { ProductView } from './productPresenter'
import type { ApiResult } from '../../../utils/apiResult'

import { withList } from '../../../utils/response'
import { toDecimal } from '../../../utils/decimal'
import { product, category } from '../../../models'
import { presentProduct } from './productPresenter'
import { HTTP_STATUS } from '../../../constants/httpStatus'
import { getDefaultCategoryId } from '../../../services/ensureDefaultCategory'
import {
  validateProductId,
  validateProductCreate,
  validateProductUpdate,
  validateProductListQuery
} from './productValidator'

const productInclude = {
  category: { select: { id: true, name: true } }
} as const

async function assertCategoryExists(
  categoryId: number
): Promise<ApiResult<null>> {
  const record = await category.findFirst({
    where: { id: categoryId, deletedAt: null }
  })
  if (!record) {
    return { ok: false, status: HTTP_STATUS.BAD_REQUEST, message: '品类不存在' }
  }
  return { ok: true, data: null }
}

export async function listProductsFacade(input: {
  role: Role
  keyword?: unknown
  categoryId?: unknown
  page?: unknown
  pageSize?: unknown
}) {
  const queryResult = validateProductListQuery(input)
  if (!queryResult.ok) return queryResult

  const { keyword, categoryId, page, pageSize } = queryResult.data
  const where = {
    deletedAt: null,
    ...(categoryId ? { categoryId } : {}),
    ...(keyword ? { name: { contains: keyword } } : {})
  }

  const [total, list] = await Promise.all([
    product.count({ where }),
    product.findMany({
      where,
      include: productInclude,
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize
    })
  ])

  return {
    ok: true as const,
    data: withList(
      list.map((item) => presentProduct(item, input.role)),
      total
    )
  }
}

export async function getProductFacade(input: {
  role: Role
  id: unknown
}): Promise<ApiResult<ProductView>> {
  const idResult = validateProductId(input.id)
  if (!idResult.ok) return idResult

  const record = await product.findFirst({
    where: { id: idResult.data.id, deletedAt: null },
    include: productInclude
  })
  if (!record) {
    return { ok: false, status: HTTP_STATUS.NOT_FOUND, message: '商品不存在' }
  }

  return { ok: true, data: presentProduct(record, input.role) }
}

export async function createProductFacade(input: {
  role: Role
  body: Record<string, unknown>
}): Promise<ApiResult<ProductView>> {
  const validated = validateProductCreate(input.body)
  if (!validated.ok) return validated

  const categoryId = validated.data.categoryId ?? (await getDefaultCategoryId())
  const categoryResult = await assertCategoryExists(categoryId)
  if (!categoryResult.ok) return categoryResult

  const created = await product.create({
    data: {
      name: validated.data.name,
      retailPrice: toDecimal(validated.data.retailPrice),
      wholesalePrice:
        validated.data.wholesalePrice === null
          ? null
          : toDecimal(validated.data.wholesalePrice),
      purchasePrice:
        validated.data.purchasePrice === null
          ? null
          : toDecimal(validated.data.purchasePrice),
      image: validated.data.image,
      stock: validated.data.stock,
      categoryId
    },
    include: productInclude
  })

  return { ok: true, data: presentProduct(created, input.role) }
}

export async function updateProductFacade(input: {
  role: Role
  body: Record<string, unknown>
}): Promise<ApiResult<ProductView>> {
  const validated = validateProductUpdate(input.body)
  if (!validated.ok) return validated

  const existing = await product.findFirst({
    where: { id: validated.data.id, deletedAt: null }
  })
  if (!existing) {
    return { ok: false, status: HTTP_STATUS.NOT_FOUND, message: '商品不存在' }
  }

  if (validated.data.categoryId !== undefined) {
    const categoryResult = await assertCategoryExists(validated.data.categoryId)
    if (!categoryResult.ok) return categoryResult
  }

  const updated = await product.update({
    where: { id: existing.id },
    data: {
      ...(validated.data.name !== undefined
        ? { name: validated.data.name }
        : {}),
      ...(validated.data.retailPrice !== undefined
        ? { retailPrice: toDecimal(validated.data.retailPrice) }
        : {}),
      ...(validated.data.wholesalePrice !== undefined
        ? {
            wholesalePrice:
              validated.data.wholesalePrice === null
                ? null
                : toDecimal(validated.data.wholesalePrice)
          }
        : {}),
      ...(validated.data.purchasePrice !== undefined
        ? {
            purchasePrice:
              validated.data.purchasePrice === null
                ? null
                : toDecimal(validated.data.purchasePrice)
          }
        : {}),
      ...(validated.data.image !== undefined
        ? { image: validated.data.image }
        : {}),
      ...(validated.data.stock !== undefined
        ? { stock: validated.data.stock }
        : {}),
      ...(validated.data.categoryId !== undefined
        ? { categoryId: validated.data.categoryId }
        : {})
    },
    include: productInclude
  })

  return { ok: true, data: presentProduct(updated, input.role) }
}

export async function deleteProductFacade(input: {
  id: unknown
}): Promise<ApiResult<null>> {
  const idResult = validateProductId(input.id)
  if (!idResult.ok) return idResult

  const existing = await product.findFirst({
    where: { id: idResult.data.id, deletedAt: null }
  })
  if (!existing) {
    return { ok: false, status: HTTP_STATUS.NOT_FOUND, message: '商品不存在' }
  }

  await product.update({
    where: { id: existing.id },
    data: { deletedAt: new Date() }
  })
  return { ok: true, data: null }
}
