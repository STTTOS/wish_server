import type { Prisma } from '@prisma/mart-client'

import { product } from '../models'

const notDeleted = { deletedAt: null } as const

export const productInclude = {
  category: { select: { id: true, name: true } }
} as const

export type ProductListFilter = {
  keyword?: string
  categoryId?: number
  page: number
  pageSize: number
  sortBy?: 'retailPrice' | 'wholesalePrice' | 'purchasePrice'
  sortOrder?: 'asc' | 'desc'
}

/** Repository：商品持久化（软删除与 include 约定集中在此） */
export const productRepository = {
  countActiveByCategory(categoryId: number) {
    return product.count({
      where: { categoryId, ...notDeleted }
    })
  },

  findActiveById(id: number) {
    return product.findFirst({
      where: { id, ...notDeleted },
      include: productInclude
    })
  },

  findActiveByIdLite(id: number) {
    return product.findFirst({
      where: { id, ...notDeleted }
    })
  },

  async listActive(filter: ProductListFilter) {
    const where: Prisma.ProductWhereInput = {
      ...notDeleted,
      ...(filter.categoryId ? { categoryId: filter.categoryId } : {}),
      ...(filter.keyword ? { name: { contains: filter.keyword } } : {})
    }

    const orderBy: Prisma.ProductOrderByWithRelationInput[] =
      filter.sortBy && filter.sortOrder
        ? [{ [filter.sortBy]: filter.sortOrder }, { id: 'desc' }]
        : [{ updatedAt: 'desc' }, { id: 'desc' }]

    const [total, list] = await Promise.all([
      product.count({ where }),
      product.findMany({
        where,
        include: productInclude,
        orderBy,
        skip: (filter.page - 1) * filter.pageSize,
        take: filter.pageSize
      })
    ])

    return { total, list }
  },

  create(data: Prisma.ProductCreateInput) {
    return product.create({
      data,
      include: productInclude
    })
  },

  update(id: number, data: Prisma.ProductUpdateInput) {
    return product.update({
      where: { id },
      data,
      include: productInclude
    })
  },

  softDelete(id: number) {
    return product.update({
      where: { id },
      data: { deletedAt: new Date() }
    })
  }
}
