/** 彩池赔率：跟注价 / (底池 + 跟注价)。可过牌时返回 null。 */
export const computePotOdds = (
  potBb: number,
  toCallBb: number
): number | null => {
  if (!(toCallBb > 0) || !(potBb >= 0)) return null
  const den = potBb + toCallBb
  if (den <= 0) return null
  return toCallBb / den
}

/** 面对下注的粗 MDF ≈ 1 - bet/(pot+bet)；bet≈toCall（简化）。 */
export const computeMdfHint = (
  potBb: number,
  toCallBb: number
): number | null => {
  if (!(toCallBb > 0) || !(potBb >= 0)) return null
  const den = potBb + toCallBb
  if (den <= 0) return null
  return Math.max(0, Math.min(1, 1 - toCallBb / den))
}
