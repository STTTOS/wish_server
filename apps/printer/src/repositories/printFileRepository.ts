import type { Prisma } from '@prisma/printer-client'

import { printFile } from '../models'

export const printFileRepository = {
  create(data: {
    shopCode: string
    originalName: string
    cosKey: string
    cosUrl: string
    mime?: string | null
    size: number
    pageCount?: number | null
    printOptions?: Prisma.InputJsonValue
  }) {
    const createData: Prisma.PrintFileCreateInput = {
      shopCode: data.shopCode,
      originalName: data.originalName,
      cosKey: data.cosKey,
      cosUrl: data.cosUrl,
      size: data.size
    }
    if (data.mime != null) createData.mime = data.mime
    if (data.pageCount != null) createData.pageCount = data.pageCount
    if (data.printOptions !== undefined) createData.printOptions = data.printOptions
    return printFile.create({ data: createData })
  },

  listByShop(shopCode: string) {
    return printFile.findMany({
      where: { shopCode, deletedAt: null },
      orderBy: { createdAt: 'desc' }
    })
  },

  findActiveById(id: string) {
    return printFile.findFirst({
      where: { id, deletedAt: null }
    })
  },

  updateActive(id: string, data: Prisma.PrintFileUpdateInput) {
    return printFile.update({
      where: { id },
      data
    })
  },

  softDelete(id: string, opts?: { cosPurged?: boolean }) {
    return printFile.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        ...(opts?.cosPurged ? { cosPurgedAt: new Date() } : {})
      }
    })
  },

  /** 超过保留期且 COS 尚未确认清除的记录（含已软删的孤儿） */
  listExpiredForCleanup(before: Date, take = 1000) {
    return printFile.findMany({
      where: {
        createdAt: { lt: before },
        cosPurgedAt: null,
        cosKey: { not: '' }
      },
      select: { id: true, cosKey: true },
      take,
      orderBy: { createdAt: 'asc' }
    })
  },

  /** COS 删除成功后：软删（若尚未）并标记已 purge，避免重复扫描 */
  markCosPurged(ids: string[]) {
    if (ids.length === 0) return Promise.resolve({ count: 0 })
    const now = new Date()
    return printFile.updateMany({
      where: { id: { in: ids } },
      data: {
        deletedAt: now,
        cosPurgedAt: now
      }
    })
  }
}
