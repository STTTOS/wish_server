import type { Role, Product, Category } from '@prisma/mart-client'

import { decimalToNumber } from '../../../utils/decimal'

type ProductWithCategory = Product & {
  category: Pick<Category, 'id' | 'name'>
}

export type ProductView = {
  id: number
  name: string
  retailPrice: number
  wholesalePrice: number | null
  purchasePrice?: number | null
  image: string | null
  stock: number
  categoryId: number
  category: { id: number; name: string }
  createdAt: Date
  updatedAt: Date
}

/** 按角色投影商品：非管理员不返回进价字段 */
export function presentProduct(
  record: ProductWithCategory,
  role: Role
): ProductView {
  const base: ProductView = {
    id: record.id,
    name: record.name,
    retailPrice: decimalToNumber(record.retailPrice)!,
    wholesalePrice: decimalToNumber(record.wholesalePrice),
    image: record.image,
    stock: record.stock,
    categoryId: record.categoryId,
    category: {
      id: record.category.id,
      name: record.category.name
    },
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  }

  if (role === 'admin') {
    base.purchasePrice = decimalToNumber(record.purchasePrice)
  }

  return base
}
