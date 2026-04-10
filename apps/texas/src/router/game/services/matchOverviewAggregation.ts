import type { Texas } from 'texas-poker-core'
import type { WsMatchOverview } from '../../../ws/ws-event-types'

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
 * `wagerList.totalWager`：优先 `当前桌上余额 − 本房累计补码 − 房间 initialChips`；
 * 与 `Σ playerMatchRecord.wager` 在记账一致时等价。`billList` 由该净额取整归零后清账。
 */
export async function fetchMatchOverviewForRoom(
  roomId: number,
  texas?: Texas | null
): Promise<WsMatchOverview> {
  // 房间起始筹码、按人累计 wager / 补码、每人最近一手桌上面额
  const [roomRow, wagerGroups, topUpGroups, balanceRows] = await Promise.all([
    prisma.room.findFirst({
      where: { id: roomId, deletedAt: null },
      select: { initialChips: true }
    }),
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
    }),
    prisma.playerMatchRecord.findMany({
      where: {
        match: { roomId },
        balanceAfterHand: { not: null }
      },
      select: { userId: true, balanceAfterHand: true, matchId: true },
      orderBy: { matchId: 'desc' }
    })
  ])

  const initialChips = roomRow?.initialChips ?? 0

  const latestBalanceByUser = new Map<number, number>()
  // matchId 降序：每个 userId 只保留最近一手
  for (const row of balanceRows) {
    if (latestBalanceByUser.has(row.userId)) continue
    latestBalanceByUser.set(row.userId, row.balanceAfterHand!)
  }

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

  const floatPositions = Array.from(byUser.entries()).map(([userId, v]) => {
    let balance: number | undefined

    const enginePlayer = texas?.room.getPlayerById(userId)
    if (enginePlayer != null) {
      // 仍在桌：引擎余额与本手刚落库的 balanceAfterHand 一致
      balance = Math.round(enginePlayer.balance)
    } else if (latestBalanceByUser.has(userId)) {
      // 已离桌等：取本房最近一手的 balanceAfterHand
      balance = latestBalanceByUser.get(userId)
    }

    let net: number
    if (balance !== undefined) {
      net = balance - v.chipTopUpAmount - initialChips
    } else {
      // 无快照：用库内累计 wager
      net = v.wagerSum
    }

    return { userId, net }
  })

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

  return { wagerList, billList }
}
