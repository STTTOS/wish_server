import type { Prisma } from '@prisma/mart-client'
import type { ProductCreateData, ProductUpdateData } from './productValidator'

import { toDecimal } from '../../../utils/decimal'

/** Mapper：校验后的写模型 → Prisma 写入数据 */
export function mapProductCreateData(
  data: ProductCreateData,
  categoryId: number
): Prisma.ProductCreateInput {
  return {
    name: data.name,
    description: data.description,
    retailPrice: toDecimal(data.retailPrice),
    wholesalePrice:
      data.wholesalePrice === null ? null : toDecimal(data.wholesalePrice),
    purchasePrice:
      data.purchasePrice === null ? null : toDecimal(data.purchasePrice),
    image: data.image,
    stock: data.stock,
    category: { connect: { id: categoryId } }
  }
}

export function mapProductUpdateData(
  data: ProductUpdateData
): Prisma.ProductUpdateInput {
  const patch: Prisma.ProductUpdateInput = {}

  if (data.name !== undefined) patch.name = data.name
  if (data.description !== undefined) patch.description = data.description
  if (data.retailPrice !== undefined) {
    patch.retailPrice = toDecimal(data.retailPrice)
  }
  if (data.wholesalePrice !== undefined) {
    patch.wholesalePrice =
      data.wholesalePrice === null ? null : toDecimal(data.wholesalePrice)
  }
  if (data.purchasePrice !== undefined) {
    patch.purchasePrice =
      data.purchasePrice === null ? null : toDecimal(data.purchasePrice)
  }
  if (data.image !== undefined) patch.image = data.image
  if (data.stock !== undefined) patch.stock = data.stock
  if (data.categoryId !== undefined) {
    patch.category = { connect: { id: data.categoryId } }
  }

  return patch
}
