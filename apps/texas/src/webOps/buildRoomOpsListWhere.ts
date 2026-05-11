import type { RoomTableType } from '../constants/game'
import type { Prisma, RoomGameStatus } from '@prisma/texas-client'

export type BuildRoomOpsListWhereArgs = {
  /** 非 `all` 时已在外层校验为合法 `RoomGameStatus` */
  gameStatus?: RoomGameStatus
  /** 房主 `User.name`（游戏昵称）子串，已 trim */
  ownerNameContains?: string
  /** 已校验的 `Room.tableType` */
  tableType?: RoomTableType
}

/**
 * 管理端 `POST .../room-ops/list` 的 Prisma `where`（仅未删除房间）。
 */
export function buildRoomOpsListWhere(
  args: BuildRoomOpsListWhereArgs
): Prisma.RoomWhereInput {
  const where: Prisma.RoomWhereInput = { deletedAt: null }

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
