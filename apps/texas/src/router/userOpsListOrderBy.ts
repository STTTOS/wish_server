import type { Prisma } from '@prisma/texas-client'

export type UserOpsListSortBody = {
  sortField?: string
  /** 与 `sortField=matchRecordsCount` 联用：`asc` | `desc` */
  sortOrder?: string
}

/**
 * 用户运维列表排序：默认 `id desc`；仅支持按参与对局条数（`_count.matchRecords`）排序。
 */
export function orderByForUserOpsList(
  body: UserOpsListSortBody
): Prisma.UserOrderByWithRelationInput {
  if (
    body.sortField === 'matchRecordsCount' &&
    (body.sortOrder === 'asc' || body.sortOrder === 'desc')
  ) {
    return {
      matchRecords: { _count: body.sortOrder }
    }
  }
  return { id: 'desc' }
}
