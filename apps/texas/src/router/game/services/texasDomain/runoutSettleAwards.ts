/**
 * 二次跑马：把每跑分到的毛筹码，按「该跑半池占底池比例」摊还本人投入，得到每跑净输赢。
 * 与整手 `Player.earn` 后的净 `wager` 之和一致（未计 27o 等局外加减）。
 */
export function computeRunWagers(args: {
  userId: number
  totalBetAmount: number
  potTotal: number
  /** 两跑各自 userId → 分到毛额；缺省当 0 */
  runAwards: [ReadonlyMap<number, number>, ReadonlyMap<number, number>]
}): [number, number] {
  const { userId, totalBetAmount, potTotal, runAwards } = args
  if (!(potTotal > 0)) return [0, 0]
  const half1 = Math.ceil(potTotal / 2)
  const half2 = potTotal - half1
  const award1 = runAwards[0].get(userId) ?? 0
  const award2 = runAwards[1].get(userId) ?? 0
  const share1 = (totalBetAmount * half1) / potTotal
  const share2 = (totalBetAmount * half2) / potTotal
  return [award1 - share1, award2 - share2]
}

export function runAwardsFromPoolMaps(
  runAwards: [ReadonlyMap<number, number>, ReadonlyMap<number, number>] | null
): Array<Array<{ userId: number; amount: number }>> | null {
  if (runAwards == null) return null
  return runAwards.map((m) =>
    Array.from(m.entries()).map(([userId, amount]) => ({ userId, amount }))
  )
}

export function mapsFromStoredRunAwards(
  stored: unknown
): [Map<number, number>, Map<number, number>] | null {
  if (!Array.isArray(stored) || stored.length < 2) return null
  const toMap = (row: unknown): Map<number, number> => {
    const m = new Map<number, number>()
    if (!Array.isArray(row)) return m
    for (const item of row) {
      if (
        item != null &&
        typeof item === 'object' &&
        'userId' in item &&
        'amount' in item
      ) {
        const userId = Number((item as { userId: unknown }).userId)
        const amount = Number((item as { amount: unknown }).amount)
        if (Number.isFinite(userId) && Number.isFinite(amount)) {
          m.set(userId, amount)
        }
      }
    }
    return m
  }
  const run1 = toMap(stored[0])
  const run2 = toMap(stored[1])
  if (run1.size === 0 && run2.size === 0) return null
  return [run1, run2]
}

/**
 * 无 awards 落库时：用每跑 winnerUserIds + 半池均分还原毛额（兼容旧 settlementRuns）。
 */
export function mapsFromWinnerUserIds(args: {
  potTotal: number
  runs: ReadonlyArray<{ winnerUserIds?: number[] | null } | null | undefined>
}): [Map<number, number>, Map<number, number>] | null {
  if (!(args.potTotal > 0) || args.runs.length < 2) return null
  const half1 = Math.ceil(args.potTotal / 2)
  const half2 = args.potTotal - half1
  const build = (winners: number[] | null | undefined, half: number) => {
    const m = new Map<number, number>()
    const ids = (winners ?? []).filter((id) => Number.isFinite(id))
    if (ids.length === 0 || !(half > 0)) return m
    const base = Math.floor(half / ids.length)
    let rem = half - base * ids.length
    for (const id of ids) {
      const extra = rem > 0 ? 1 : 0
      if (rem > 0) rem -= 1
      m.set(id, base + extra)
    }
    return m
  }
  const run1 = build(args.runs[0]?.winnerUserIds, half1)
  const run2 = build(args.runs[1]?.winnerUserIds, half2)
  if (run1.size === 0 && run2.size === 0) return null
  return [run1, run2]
}
