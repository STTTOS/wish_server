import type { Role, Product, Category } from '@prisma/mart-client'

import { decimalToNumber } from '../../../utils/decimal'
import { getProductVisibilityPolicy } from '../../../domain/policies/productVisibilityPolicy'

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

/** Presenter：领域记录 → API 视图（配合可见性策略） */
export function presentProduct(
  record: ProductWithCategory,
  role: Role
): ProductView {
  const policy = getProductVisibilityPolicy(role)

  const view: ProductView = {
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

  if (policy.showPurchasePrice) {
    view.purchasePrice = decimalToNumber(record.purchasePrice)
  }

  return view
}
