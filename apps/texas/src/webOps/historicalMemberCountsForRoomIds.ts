import { roomMember, roomChipTopUp, playerMatchRecord } from '../models'

/**
 * 与对局汇总一致：每房「当前成员 ∪ 有对局记录 ∪ 有补码」的去重用户数。
 */
export async function historicalMemberCountsForRoomIds(
  roomIds: number[]
): Promise<Map<number, number>> {
  const out = new Map<number, number>()
  if (roomIds.length === 0) return out

  const [members, pmrRows, topUps] = await Promise.all([
    roomMember.findMany({
      where: { roomId: { in: roomIds } },
      select: { roomId: true, userId: true }
    }),
    playerMatchRecord.findMany({
      where: { match: { roomId: { in: roomIds } } },
      select: { userId: true, match: { select: { roomId: true } } }
    }),
    roomChipTopUp.findMany({
      where: { roomId: { in: roomIds } },
      select: { roomId: true, userId: true }
    })
  ])

  const sets = new Map<number, Set<number>>()
  const add = (roomId: number, userId: number) => {
    let s = sets.get(roomId)
    if (!s) {
      s = new Set()
      sets.set(roomId, s)
    }
    s.add(userId)
  }

  for (const m of members) add(m.roomId, m.userId)
  for (const p of pmrRows) add(p.match.roomId, p.userId)
  for (const t of topUps) add(t.roomId, t.userId)

  for (const id of roomIds) {
    out.set(id, sets.get(id)?.size ?? 0)
  }
  return out
}
