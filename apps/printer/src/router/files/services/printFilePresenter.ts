import type { PrintFile } from '@prisma/printer-client'

export function presentPrintFile(row: PrintFile) {
  return {
    id: row.id,
    shopCode: row.shopCode,
    originalName: row.originalName,
    cosKey: row.cosKey,
    cosUrl: row.cosUrl,
    mime: row.mime,
    size: row.size,
    pageCount: row.pageCount,
    status: row.status,
    printOptions: row.printOptions,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  }
}

export type PresentedPrintFile = ReturnType<typeof presentPrintFile>
