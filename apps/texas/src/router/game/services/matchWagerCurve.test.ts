import test from 'node:test'
import assert from 'node:assert/strict'

/** 纯函数版方案 C，与 fetchMatchWagerCurveForRoom 同口径（单测不打 DB）。 */
function buildHoldLastSeries(
  matches: Array<{
    id: number
    seats: Array<{ userId: number; wager: number }>
  }>,
  userIds: number[]
) {
  return userIds.map((userId) => {
    const cumulatives: Array<number | null> = []
    const participated: boolean[] = []
    let cum: number | null = null
    for (const m of matches) {
      const row = m.seats.find((p) => p.userId === userId)
      if (row != null) {
        cum = (cum ?? 0) + row.wager
        cumulatives.push(cum)
        participated.push(true)
      } else if (cum != null) {
        cumulatives.push(cum)
        participated.push(false)
      } else {
        cumulatives.push(null)
        participated.push(false)
      }
    }
    return { userId, cumulatives, participated }
  })
}

test('scheme C: late join starts null then accumulates; leave holds last', () => {
  const matches = [
    {
      id: 1,
      seats: [
        { userId: 1, wager: 100 },
        { userId: 2, wager: -100 }
      ]
    },
    {
      id: 2,
      seats: [
        { userId: 1, wager: -50 },
        { userId: 2, wager: 50 }
      ]
    },
    {
      id: 3,
      seats: [
        { userId: 2, wager: 20 },
        { userId: 3, wager: -20 }
      ]
    }
  ]
  const series = buildHoldLastSeries(matches, [1, 2, 3])
  const byId = new Map(series.map((s) => [s.userId, s]))

  assert.deepEqual(byId.get(1)?.cumulatives, [100, 50, 50])
  assert.deepEqual(byId.get(1)?.participated, [true, true, false])

  assert.deepEqual(byId.get(2)?.cumulatives, [-100, -50, -30])
  assert.deepEqual(byId.get(2)?.participated, [true, true, true])

  assert.deepEqual(byId.get(3)?.cumulatives, [null, null, -20])
  assert.deepEqual(byId.get(3)?.participated, [false, false, true])
})
