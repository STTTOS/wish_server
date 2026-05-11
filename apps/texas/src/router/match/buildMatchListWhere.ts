import type { Stage, Prisma } from '@prisma/texas-client'
import type { RoomTableType } from '../../constants/game'

export type MatchListTimeRange = { start: Date; end: Date }

/** 对局是否已产生结束时间 */
export type MatchListProgressFilter = 'all' | 'in_progress' | 'ended'

export type BuildMatchListWhereArgs = {
  viewerUserId: number
  isAdmin: boolean
  /** 已校验的 `room.tableType`，不含 `all` */
  tableType?: RoomTableType
  timeRange?: MatchListTimeRange
  matchProgress?: MatchListProgressFilter
  /** 已校验的 `Match.boardThroughStage`；与 `matchProgress` 组合时为 AND */
  boardThroughStage?: Stage
  /**
   * 仅管理员生效：任一参与用户 `User.name`（游戏昵称）包含该子串。
   * 非管理员调用方应不传或忽略，避免与普通用户「仅本人对局」语义冲突。
   */
  participantNameContains?: string
}

/**
 * Web `POST .../match/list` 的 Prisma `where` 拼装（鉴权与参数校验在路由层）。
 */
export function buildMatchListWhere(
  args: BuildMatchListWhereArgs
): Prisma.MatchWhereInput {
  const where: Prisma.MatchWhereInput = {}

  if (!args.isAdmin) {
    where.playerMatchRecords = {
      some: { userId: args.viewerUserId }
    }
  }

  if (args.timeRange) {
    where.startedAt = {
      gte: args.timeRange.start,
      lte: args.timeRange.end
    }
  }

  if (args.tableType) {
    where.room = { is: { tableType: args.tableType } }
  }

  if (args.matchProgress === 'in_progress') {
    where.endedAt = null
  } else if (args.matchProgress === 'ended') {
    where.endedAt = { not: null }
  }

  if (args.boardThroughStage) {
    where.boardThroughStage = args.boardThroughStage
  }

  if (args.isAdmin && args.participantNameContains) {
    where.playerMatchRecords = {
      some: {
        user: { name: { contains: args.participantNameContains } }
      }
    }
  }

  return where
}
