/** 样本过少不展示强度，避免偶然一手拉满 */
export const COPLAY_INTENSITY_MIN_HANDS = 3
/** 频次分满分手数 */
export const COPLAY_INTENSITY_FREQ_CAP = 30
/** 池深达到该 BB 视为「大池」对峙候选 */
export const COPLAY_INTENSITY_POT_BB = 15
/** 双方至少各投入该 BB 才算参与对峙 */
export const COPLAY_INTENSITY_MIN_BET_BB = 1

export type CoplayIntensityTier = 'cold' | 'warm' | 'hot' | 'blazing'

export type CoplayIntensity = {
  /** 0–100 */
  score: number
  tier: CoplayIntensityTier
}

export type SharedHandForIntensity = {
  /** 大盲，≤0 时按 1 处理 */
  lowestBetAmount: number
  /** 本手总池；缺省按 0 */
  matchTotalBetAmount: number
  myTotalBetAmount: number
  peerTotalBetAmount: number
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0
  if (n <= 0) return 0
  if (n >= 1) return 1
  return n
}

/** 单手是否算「有对抗」的大池/双方投入 */
export function isHeatedSharedHand(hand: SharedHandForIntensity): boolean {
  const bb = hand.lowestBetAmount > 0 ? hand.lowestBetAmount : 1
  const potBb = hand.matchTotalBetAmount / bb
  const minBet = bb * COPLAY_INTENSITY_MIN_BET_BB
  const bothIn =
    hand.myTotalBetAmount >= minBet && hand.peerTotalBetAmount >= minBet
  return bothIn && potBb >= COPLAY_INTENSITY_POT_BB
}

export function tierFromScore(score: number): CoplayIntensityTier {
  if (score >= 75) return 'blazing'
  if (score >= 50) return 'hot'
  if (score >= 25) return 'warm'
  return 'cold'
}

/**
 * 交手强度 = 频次×0.4 + 烈度×0.45 + 新鲜×0.15。
 * 不用净输赢；样本不足 MIN 返回 null。
 */
export function computeCoplayIntensity(input: {
  playCount: number
  heatedHandCount: number
  lastPlayedTs: number
  nowTs: number
  /** 新鲜度衰减窗口（天），默认与同玩列表一致 */
  freshLookbackDays?: number
}): CoplayIntensity | null {
  const {
    playCount,
    heatedHandCount,
    lastPlayedTs,
    nowTs,
    freshLookbackDays = 15
  } = input
  if (playCount < COPLAY_INTENSITY_MIN_HANDS) return null

  const freq = clamp01(playCount / COPLAY_INTENSITY_FREQ_CAP)
  const heat = clamp01(heatedHandCount / playCount)
  const dayMs = 24 * 60 * 60 * 1000
  const daysSince = Math.max(0, (nowTs - lastPlayedTs) / dayMs)
  const fresh = clamp01(1 - daysSince / Math.max(freshLookbackDays, 1))

  const score = Math.round(100 * (0.4 * freq + 0.45 * heat + 0.15 * fresh))
  const bounded = Math.max(0, Math.min(100, score))
  return { score: bounded, tier: tierFromScore(bounded) }
}
