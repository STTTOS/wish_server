import type { RoomTableType } from '../constants/game'
import type { Prisma, RoomGameStatus } from '@prisma/texas-client'

/** `all` 含软删；`active` 仅未解散；`dissolved` 仅已软删 */
export type RoomOpsLifecycleFilter = 'all' | 'active' | 'dissolved'

export type BuildRoomOpsListWhereArgs = {
  /** 非 `all` 时已在外层校验为合法 `RoomGameStatus` */
  gameStatus?: RoomGameStatus
  /** 房主 `User.name`（游戏昵称）子串，已 trim */
  ownerNameContains?: string
  /** 已校验的 `Room.tableType` */
  tableType?: RoomTableType
  /** 默认 `all`（含已解散）；`active` 仅未解散；`dissolved` 仅已软删 */
  lifecycle?: RoomOpsLifecycleFilter
}

/**
 * 管理端 `POST .../room-ops/list` 的 Prisma `where`。
 */
export function buildRoomOpsListWhere(
  args: BuildRoomOpsListWhereArgs
): Prisma.RoomWhereInput {
  const where: Prisma.RoomWhereInput = {}

  const lifecycle = args.lifecycle ?? 'all'
  if (lifecycle === 'active') {
    where.deletedAt = null
  } else if (lifecycle === 'dissolved') {
    where.deletedAt = { not: null }
  }

  if (args.gameStatus) {
    where.gameStatus = args.gameStatus
  }

  if (args.ownerNameContains) {
    where.owner = {
      is: { name: { contains: args.ownerNameContains } }
    }
  }

  if (args.tableType) {
    where.tableType = args.tableType
  }

  return where
}
