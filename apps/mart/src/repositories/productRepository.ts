import type { Prisma } from '@prisma/mart-client'

import { Prisma as PrismaNS } from '@prisma/mart-client'

import prisma, { product } from '../models'
import {
  splitSearchTokens,
  buildContainsLikePattern,
  buildNameSubsequenceLikePattern
} from '../utils/productSearch'

const notDeleted = { deletedAt: null } as const

export class ProductNotFoundForCheckoutError extends Error {
  readonly productId: number

  constructor(productId: number) {
    super(`商品不存在（id=${productId}）`)
    this.name = 'ProductNotFoundForCheckoutError'
    this.productId = productId
  }
}

export const productInclude = {
  category: { select: { id: true, name: true } }
} as const

export type ProductListFilter = {
  keyword?: string
  /** 仅匹配条码字段（连续子串） */
  barcode?: string
  categoryId?: number
  page: number
  pageSize: number
  sortBy?: 'retailPrice' | 'wholesalePrice' | 'purchasePrice' | 'barcode'
  sortOrder?: 'asc' | 'desc'
}

function buildTokenMatchSql(token: string) {
  const namePattern = buildNameSubsequenceLikePattern(token)
  const barcodePattern = buildContainsLikePattern(token)
  return PrismaNS.sql`(
    (c.deletedAt IS NULL AND c.name = ${token})
    OR p.name LIKE ${namePattern}
    OR p.description LIKE ${namePattern}
    OR p.aliases LIKE ${namePattern}
    OR p.barcode LIKE ${barcodePattern}
  )`
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

  findActiveByBarcode(barcode: string) {
    return product.findFirst({
      where: { barcode, ...notDeleted },
      include: productInclude
    })
  },

  /** 查重：同条码是否已被任意商品占用（含软删，因 DB 唯一索引覆盖全表） */
  findAnyByBarcodeExcept(barcode: string, excludeId?: number) {
    return product.findFirst({
      where: {
        barcode,
        ...(excludeId != null ? { id: { not: excludeId } } : {})
      }
    })
  },

  async listActive(filter: ProductListFilter) {
    const where: Prisma.ProductWhereInput = {
      ...notDeleted,
      ...(filter.categoryId ? { categoryId: filter.categoryId } : {})
    }

    if (filter.barcode) {
      where.barcode = { contains: filter.barcode.replace(/\s+/g, '') }
    }

    if (filter.keyword) {
      const tokens = splitSearchTokens(filter.keyword)
      if (tokens.length > 0) {
        const tokenClauses = tokens.map(buildTokenMatchSql)
        const rows = await prisma.$queryRaw<{ id: number }[]>`
          SELECT p.id AS id
          FROM Product p
          INNER JOIN Category c ON c.id = p.categoryId
          WHERE p.deletedAt IS NULL
            AND ${PrismaNS.join(tokenClauses, ' AND ')}
            ${
              filter.categoryId != null
                ? PrismaNS.sql`AND p.categoryId = ${filter.categoryId}`
                : PrismaNS.empty
            }
            ${
              filter.barcode
                ? PrismaNS.sql`AND p.barcode LIKE ${buildContainsLikePattern(
                    filter.barcode
                  )}`
                : PrismaNS.empty
            }
        `
        const ids = rows.map((row) => row.id)
        if (ids.length === 0) {
          return { total: 0, withoutBarcode: 0, list: [] }
        }
        where.id = { in: ids }
      }
    }

    let orderBy: Prisma.ProductOrderByWithRelationInput[]
    if (filter.sortBy === 'barcode') {
      // MySQL ASC 默认 NULL 在前，实现「未设条码优先」
      orderBy = [{ barcode: 'asc' }, { createdAt: 'desc' }, { id: 'desc' }]
    } else if (filter.sortBy && filter.sortOrder) {
      orderBy = [{ [filter.sortBy]: filter.sortOrder }, { id: 'desc' }]
    } else {
      orderBy = [{ createdAt: 'desc' }, { id: 'desc' }]
    }

    const withoutBarcodeWhere: Prisma.ProductWhereInput = {
      ...where,
      barcode: null
    }

    const [total, withoutBarcode, list] = await Promise.all([
      product.count({ where }),
      product.count({ where: withoutBarcodeWhere }),
      product.findMany({
        where,
        include: productInclude,
        orderBy,
        skip: (filter.page - 1) * filter.pageSize,
        take: filter.pageSize
      })
    ])

    return { total, withoutBarcode, list }
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
      // 释放条码唯一约束，避免软删记录继续占码
      data: { deletedAt: new Date(), barcode: null }
    })
  },

  clearBarcode(id: number) {
    return product.update({
      where: { id },
      data: { barcode: null }
    })
  },

  /**
   * 结账扣库存（事务）：允许扣到 0 以下视为 0，不因库存不足拒绝。
   * 任一商品不存在则整笔回滚。
   */
  deductStockForCheckout(
    items: ReadonlyArray<{ productId: number; quantity: number }>
  ) {
    return prisma.$transaction(async (tx) => {
      const deducted: Array<{
        productId: number
        quantity: number
        stock: number
      }> = []

      for (const item of items) {
        const record = await tx.product.findFirst({
          where: { id: item.productId, ...notDeleted },
          select: { id: true, stock: true }
        })
        if (!record) {
          throw new ProductNotFoundForCheckoutError(item.productId)
        }

        const stock = Math.max(record.stock - item.quantity, 0)
        await tx.product.update({
          where: { id: item.productId },
          data: { stock }
        })
        deducted.push({
          productId: item.productId,
          quantity: item.quantity,
          stock
        })
      }

      return deducted
    })
  }
}
