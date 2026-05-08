import type { Role } from '@prisma/texas-client'

/**
 * 对局详情结算行：底牌与牌力同一套可见性（本人始终可见；
 * 他人：弃牌者不可见；一人独赢无摊牌时其余所有人底牌与牌力均不可见）。
 * Web `match/detail` 与客户端 `matchApi('/detail')` 共用；不因管理员身份放宽。
 */
export function settleRecordVisibleFields<
  H,
  C extends string | null,
  S extends number,
  Sig extends string | null | undefined
>(args: {
  isSelf: boolean
  isFold: boolean
  hideHoleCardsFromViewer: boolean
  handPokes: H
  rankCategory: C
  rankStrength: S
  rankSignature?: Sig
}): {
  handPokes: H | []
  rankCategory: C | null
  rankStrength: S | 0
  rankSignature: string | null
} {
  const {
    isSelf,
    hideHoleCardsFromViewer,
    handPokes,
    rankCategory,
    rankStrength,
    rankSignature
  } = args
  const visible = isSelf || !hideHoleCardsFromViewer
  return {
    handPokes: visible ? handPokes : [],
    rankCategory: visible ? rankCategory : null,
    rankStrength: visible ? rankStrength : 0,
    rankSignature: visible ? rankSignature ?? null : null
  }
}

export function sortSettleRecordsByOutcome<
  T extends { isFold: boolean; rankStrength: number; wager: number | null }
>(records: readonly T[]): T[] {
  const wagerDesc = (
    a: { wager: number | null },
    b: { wager: number | null }
  ) => (Number(b.wager) || 0) - (Number(a.wager) || 0)
  return [...records].sort((a, b) => {
    if (a.isFold !== b.isFold) return a.isFold ? 1 : -1
    if (!a.isFold && !b.isFold) {
      if (a.rankStrength !== b.rankStrength) {
        return b.rankStrength - a.rankStrength
      }
      return wagerDesc(a, b)
    }
    return wagerDesc(a, b)
  })
}

/** 仅一人未弃牌收池，无摊牌；赢家底牌对其他人不可见 */
export function isNoShowdownSingleWinnerFromParticipants(
  records: ReadonlyArray<{ isFold: boolean }>
): boolean {
  const totalPlayers = records.length
  const foldedCount = records.filter((p) => p.isFold).length
  return totalPlayers >= 1 && foldedCount === totalPlayers - 1
}

export type PlayerMatchRecordForSettleProjection = {
  id: number
  userId?: number
  role: Role | null
  isFold: boolean
  wager: number | null
  isAllIn: boolean
  handPokes: unknown
  rankStrength: number
  rankCategory: string | null
  rankSignature?: string | null
  totalBetAmount?: number | null
  sevenTwoBonusPaid?: number
  sevenTwoBonusReceived?: number
  balanceAtHandStart?: number | null
  balanceAfterHand?: number | null
  voluntaryShowHandAt?: Date | null
  user: {
    id: number
    name: string
    avatarUrl: string | null
    avatarKey?: string
    pokerBackgroundKey?: string
  }
}

export function projectSettleRecordsForMatchDetail(
  playerMatchRecords: readonly PlayerMatchRecordForSettleProjection[],
  opts: { viewerUserId: number }
) {
  const sorted = sortSettleRecordsByOutcome(playerMatchRecords)
  const isNoShowdownSingleWinner =
    isNoShowdownSingleWinnerFromParticipants(playerMatchRecords)

  return sorted.map(
    ({
      user: { id: recordUserId, ...user },
      handPokes,
      isFold,
      rankCategory,
      rankStrength,
      rankSignature,
      ...rest
    }) => {
      const isSelf = recordUserId === opts.viewerUserId
      const hideHoleCardsFromViewer =
        !isSelf && (isFold || isNoShowdownSingleWinner)

      const {
        handPokes: outHandPokes,
        rankCategory: outRankCategory,
        rankStrength: outRankStrength,
        rankSignature: outRankSignature
      } = settleRecordVisibleFields({
        isSelf,
        isFold,
        hideHoleCardsFromViewer,
        handPokes,
        rankCategory,
        rankStrength,
        rankSignature
      })

      return {
        ...user,
        ...rest,
        userId: recordUserId,
        isFold,
        handPokes: outHandPokes,
        rankCategory: outRankCategory,
        rankStrength: outRankStrength,
        rankSignature: outRankSignature
      }
    }
  )
}
