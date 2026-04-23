import type { WsMatchOverview } from '@wishufree/texas-ws-contract'

import prisma from '../../../models'
import {
  normalizeIntegerZeroSum,
  buildBillListFromNetByUser
} from './matchBillList'

type UserAgg = {
  wagerSum: number
  chipTopUpCount: number
  chipTopUpAmount: number
}

/**
 * 房间内对局总览：含曾参与本房任意一手或有过局间补码的用户（含已退房间成员）。
 *
 * `wagerList.totalWager`：本房 `PlayerMatchRecord.wager` 按人累加（零和），再取整归零；
 * 不用「余额 − 补码 − initialChips」——玩家离桌再进会多次带入，与单段起始筹码对不齐。
 * `billList` 由该净额清账。补码字段仅作展示，客户端可自行算「相对钱包」等衍生指标。
 */
export async function fetchMatchOverviewForRoom(
  roomId: number
): Promise<WsMatchOverview> {
  // 按人累计本房 wager、补码次数与金额
  const [wagerGroups, topUpGroups] = await Promise.all([
    prisma.playerMatchRecord.groupBy({
      by: ['userId'],
      where: { match: { roomId } },
      _sum: { wager: true }
    }),
    prisma.roomChipTopUp.groupBy({
      by: ['userId'],
      where: { roomId },
      _sum: { amount: true },
      _count: { _all: true }
    })
  ])

  const byUser = new Map<number, UserAgg>()

  for (const row of wagerGroups) {
    const w = row._sum.wager
    let wagerSum = 0
    if (w != null && !Number.isNaN(Number(w))) {
      wagerSum = Number(w)
    }
    byUser.set(row.userId, {
      wagerSum,
      chipTopUpCount: 0,
      chipTopUpAmount: 0
    })
  }

  for (const row of topUpGroups) {
    const prev = byUser.get(row.userId) ?? {
      wagerSum: 0,
      chipTopUpCount: 0,
      chipTopUpAmount: 0
    }
    prev.chipTopUpCount = row._count._all
    prev.chipTopUpAmount = row._sum.amount ?? 0
    byUser.set(row.userId, prev)
  }

  const userIds = Array.from(byUser.keys())
  const users =
    userIds.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: userIds } },
          select: {
            id: true,
            name: true,
            avatarUrl: true,
            avatarKey: true,
            pokerBackgroundKey: true
          }
        })
      : []
  const profileByUserId = new Map(users.map((u) => [u.id, u]))

  const floatPositions = Array.from(byUser.entries()).map(([userId, v]) => ({
    userId,
    net: v.wagerSum
  }))

  // 取整并修正舍入误差，保证全房净额之和为 0，再清账
  const normalized = normalizeIntegerZeroSum(floatPositions)

  const wagerList = normalized
    .map((n) => {
      const extra = byUser.get(n.userId)!
      return {
        userId: n.userId,
        totalWager: n.net,
        chipTopUpCount: extra.chipTopUpCount,
        chipTopUpAmount: extra.chipTopUpAmount
      }
    })
    .sort((a, b) => a.userId - b.userId)

  const billList = buildBillListFromNetByUser(normalized)
  const playerProfiles = userIds
    .map((userId) => {
      const profile = profileByUserId.get(userId)
      return {
        userId,
        name: profile?.name ?? `玩家${userId}`,
        avatarUrl: profile?.avatarUrl ?? null,
        avatarKey: profile?.avatarKey ?? 'cartoon/default',
        pokerBackgroundKey: profile?.pokerBackgroundKey ?? null
      }
    })
    .sort((a, b) => a.userId - b.userId)

  return { wagerList, billList, playerProfiles }
}
