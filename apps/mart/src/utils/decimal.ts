import { Prisma } from '@prisma/mart-client'

/** Prisma Decimal → 前端友好的 number（金额保留 2 位） */
export function decimalToNumber(
  value: Prisma.Decimal | number | null | undefined
): number | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'number') return value
  return Number(value.toFixed(2))
}

export function toDecimal(value: number): Prisma.Decimal {
  return new Prisma.Decimal(value)
}
