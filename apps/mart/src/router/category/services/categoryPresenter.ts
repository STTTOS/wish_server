import type { Category } from '@prisma/mart-client'

export function presentCategory(record: Category) {
  return {
    id: record.id,
    name: record.name,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  }
}
