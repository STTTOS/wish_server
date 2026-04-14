/**
 * χ² 检验上侧 p 值：P(X > chiSquare)，X ~ χ²(df)。
 * 采用 Wilson–Hilferty 正态近似（df ≥ 30 时常用，本审计 df=51）。
 */

function erf(x: number): number {
  const sign = x < 0 ? -1 : 1
  const ax = Math.abs(x)
  const a1 = 0.254829592
  const a2 = -0.284496736
  const a3 = 1.421413741
  const a4 = -1.453152027
  const a5 = 1.061405429
  const p = 0.3275911
  const t = 1 / (1 + p * ax)
  const y =
    1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax)
  return sign * y
}

function normalCdf(x: number): number {
  return 0.5 * (1 + erf(x / Math.SQRT2))
}

/**
 * @returns 上侧概率，范围钳制在 [0, 1]
 */
export function chiSquareUpperTailPValue(
  chiSquare: number,
  degreesOfFreedom: number
): number {
  if (chiSquare <= 0 || degreesOfFreedom <= 0) return 1
  const nu = degreesOfFreedom
  const h = 2 / (9 * nu)
  const z = (Math.pow(chiSquare / nu, 1 / 3) - (1 - h)) / Math.sqrt(h)
  const p = 1 - normalCdf(z)
  if (p < 0) return 0
  if (p > 1) return 1
  return p
}
