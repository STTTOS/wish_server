import {
  type Poke,
  compareRankSignature,
  createStandardDeckPokes,
  getBestPokesRankSignature
} from 'texas-poker-core'

const isPoke = (s: string): s is Poke =>
  s.length >= 2 && ['h', 's', 'd', 'c'].includes(s[0]!)

const scoreRunout = (
  hero: Poke[],
  villain: Poke[],
  fullBoard: Poke[]
): number => {
  const h = getBestPokesRankSignature([hero], fullBoard)
  const v = getBestPokesRankSignature([villain], fullBoard)
  // compareRankSignature：负值表示前者更强（类别字母 z>q）
  const c = compareRankSignature(h, v)
  if (c < 0) return 1
  if (c > 0) return 0
  return 0.5
}

/**
 * Heads-up equity at an all-in point（已知底牌 + 已发公牌）。
 * 补齐至 5 张公牌后比较；剩余 0–2 张穷举，更多则抽样 400 次。
 */
export const estimateHuEquity = (
  hero: string[],
  villain: string[],
  board: string[]
): number | null => {
  if (hero.length !== 2 || villain.length !== 2) return null
  if (!hero.every(isPoke) || !villain.every(isPoke) || !board.every(isPoke)) {
    return null
  }
  if (board.length > 5) return null

  const heroP = hero as Poke[]
  const villainP = villain as Poke[]
  const boardP = board as Poke[]

  const used = new Set<string>([...heroP, ...villainP, ...boardP])
  const deck = createStandardDeckPokes().filter((p) => !used.has(p))
  const need = 5 - boardP.length
  if (need < 0) return null

  if (need === 0) {
    return scoreRunout(heroP, villainP, boardP)
  }

  let sum = 0
  let total = 0

  const add = (extra: Poke[]) => {
    sum += scoreRunout(heroP, villainP, [...boardP, ...extra])
    total += 1
  }

  if (need === 1) {
    for (const c of deck) add([c])
  } else if (need === 2) {
    for (let i = 0; i < deck.length; i++) {
      for (let j = i + 1; j < deck.length; j++) {
        add([deck[i]!, deck[j]!])
      }
    }
  } else {
    const samples = 400
    for (let s = 0; s < samples; s++) {
      const copy = deck.slice()
      const picked: Poke[] = []
      for (let k = 0; k < need; k++) {
        const idx = Math.floor(Math.random() * copy.length)
        picked.push(copy.splice(idx, 1)[0]!)
      }
      add(picked)
    }
  }

  if (total === 0) return null
  return sum / total
}
