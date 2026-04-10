/**
 * 由每人净输赢（通常为房间内累计 wager，零和）生成最少步数的「谁向谁付多少」清账列表。
 * 使用贪心：负债最多者优先付给应收最多者，金额取二者较小值；整数筹码，确定性排序。
 */

export type NetPosition = { userId: number; net: number }

export type MatchBillItem = {
  fromUserId: number
  toUserId: number
  amount: number
}

/**
 * 将浮点累计 wager 取整后，把舍入误差摊到 |net| 最大的一人，使总和严格为 0。
 */
export function normalizeIntegerZeroSum(
  positions: readonly NetPosition[]
): NetPosition[] {
  if (positions.length === 0) return []
  const out = positions.map((p) => ({
    userId: p.userId,
    net: Math.round(p.net)
  }))
  let sum = 0
  for (const p of out) sum += p.net
  if (sum === 0) return out
  let idx = 0
  for (let i = 1; i < out.length; i++) {
    if (Math.abs(out[i].net) > Math.abs(out[idx].net)) idx = i
  }
  const copy = out.map((p, i) =>
    i === idx ? { ...p, net: p.net - sum } : { ...p }
  )
  return copy
}

/**
 * @param positions 每人净输赢，应满足 sum(net) === 0（可先过 {@link normalizeIntegerZeroSum}）
 */
export function buildBillListFromNetByUser(
  positions: readonly NetPosition[]
): MatchBillItem[] {
  const nonZero = positions.filter((p) => p.net !== 0)
  if (nonZero.length === 0) return []

  const sum = nonZero.reduce((s, p) => s + p.net, 0)
  if (sum !== 0) {
    throw new Error(
      `[buildBillListFromNetByUser] sum(net) must be 0, got ${sum}`
    )
  }

  type Bucket = { userId: number; remaining: number }
  const debtors: Bucket[] = nonZero
    .filter((p) => p.net < 0)
    .map((p) => ({ userId: p.userId, remaining: p.net }))
    .sort((a, b) => a.remaining - b.remaining)

  const creditors: Bucket[] = nonZero
    .filter((p) => p.net > 0)
    .map((p) => ({ userId: p.userId, remaining: p.net }))
    .sort((a, b) => b.remaining - a.remaining)

  const bills: MatchBillItem[] = []
  let di = 0
  let ci = 0

  while (di < debtors.length && ci < creditors.length) {
    const d = debtors[di]
    const c = creditors[ci]
    const owe = -d.remaining
    const need = c.remaining
    if (owe <= 0 || need <= 0) break
    const pay = Math.min(owe, need)
    if (pay <= 0) break
    bills.push({
      fromUserId: d.userId,
      toUserId: c.userId,
      amount: pay
    })
    d.remaining += pay
    c.remaining -= pay
    if (d.remaining === 0) di += 1
    if (c.remaining === 0) ci += 1
  }

  if (di < debtors.length || ci < creditors.length) {
    throw new Error(
      '[buildBillListFromNetByUser] could not clear all positions (bug or invalid input)'
    )
  }

  return bills
}

/** 校验：清账后每人净额应为 0 */
export function assertBillsSettlePositions(
  positions: readonly NetPosition[],
  bills: readonly MatchBillItem[]
): void {
  const bal = new Map<number, number>()
  for (const p of positions) bal.set(p.userId, p.net)
  for (const b of bills) {
    bal.set(b.fromUserId, (bal.get(b.fromUserId) ?? 0) + b.amount)
    bal.set(b.toUserId, (bal.get(b.toUserId) ?? 0) - b.amount)
  }
  for (const [, v] of bal) {
    if (v !== 0) {
      throw new Error(`[assertBillsSettlePositions] residual net ${v}`)
    }
  }
}
