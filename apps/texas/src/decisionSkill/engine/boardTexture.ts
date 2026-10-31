/**
 * 公牌湿度粗分（不看洞牌）。
 * wet：同花面或强连张；dry：彩虹高张离散；否则 semi。
 */
export const classifyBoardTexture = (
  boardPokes: string[]
): 'dry' | 'semi' | 'wet' | 'unknown' => {
  if (!boardPokes.length) return 'unknown'
  const suits = boardPokes.map((p) => p[0]?.toLowerCase()).filter(Boolean)
  const ranks = boardPokes
    .map((p) => rankValue(p.slice(1).toLowerCase()))
    .filter((n): n is number => n != null)

  const suitCounts = new Map<string, number>()
  for (const s of suits) {
    suitCounts.set(s!, (suitCounts.get(s!) ?? 0) + 1)
  }
  const maxSuit = Math.max(0, ...suitCounts.values())
  const flushHeavy = maxSuit >= 3

  const uniq = [...new Set(ranks)].sort((a, b) => a - b)
  let connected = false
  for (let i = 1; i < uniq.length; i++) {
    if (uniq[i]! - uniq[i - 1]! <= 2) connected = true
  }

  if (flushHeavy || (connected && uniq.length >= 3)) return 'wet'
  if (!connected && maxSuit <= 1 && uniq.length >= 3) return 'dry'
  if (boardPokes.length < 3) return 'unknown'
  return 'semi'
}

const RANK_VAL: Record<string, number> = {
  '2': 2,
  '3': 3,
  '4': 4,
  '5': 5,
  '6': 6,
  '7': 7,
  '8': 8,
  '9': 9,
  t: 10,
  j: 11,
  q: 12,
  k: 13,
  a: 14
}

const rankValue = (r: string): number | null => RANK_VAL[r] ?? null
