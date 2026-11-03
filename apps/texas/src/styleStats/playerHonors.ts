import { playerMatchRecord } from '../models'

export type PlayerHonorsDto = {
  /** 参与手数（PlayerMatchRecord 行数） */
  hands: number
  royalFlushCount: number
  straightFlushCount: number
  fourOfKindCount: number
}

/**
 * 公开荣誉统计：大牌成就仅计未弃牌手（与 match/overview 一致）。
 * 不读隐私开关——桌内名片默认可见。
 */
export const getPlayerHonors = async (
  userId: number
): Promise<PlayerHonorsDto> => {
  const records = await playerMatchRecord.findMany({
    where: { userId },
    select: {
      isFold: true,
      rankCategory: true
    }
  })

  let royalFlushCount = 0
  let straightFlushCount = 0
  let fourOfKindCount = 0
  for (const r of records) {
    if (r.isFold) continue
    if (r.rankCategory === 'z') royalFlushCount += 1
    if (r.rankCategory === 'y') straightFlushCount += 1
    if (r.rankCategory === 'x') fourOfKindCount += 1
  }

  return {
    hands: records.length,
    royalFlushCount,
    straightFlushCount,
    fourOfKindCount
  }
}
