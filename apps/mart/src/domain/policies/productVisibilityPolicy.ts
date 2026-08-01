import type { Role } from '@prisma/mart-client'

/**
 * Strategy：按角色决定商品字段可见性。
 * 当前仅控制进价；后续敏感字段可集中扩展于此。
 */
export type ProductVisibilityPolicy = {
  showPurchasePrice: boolean
}

const adminPolicy: ProductVisibilityPolicy = {
  showPurchasePrice: true
}

const staffPolicy: ProductVisibilityPolicy = {
  showPurchasePrice: false
}

const strategies: Record<Role, ProductVisibilityPolicy> = {
  admin: adminPolicy,
  staff: staffPolicy
}

export function getProductVisibilityPolicy(
  role: Role
): ProductVisibilityPolicy {
  return strategies[role] ?? staffPolicy
}
