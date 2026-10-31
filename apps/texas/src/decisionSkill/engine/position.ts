import type { HeroPositionBucket } from './types'

/** Prisma Role → 评分用位置桶 */
export const roleToPositionBucket = (
  role: string | null | undefined
): HeroPositionBucket => {
  switch (role) {
    case 'btn':
      return 'btn'
    case 'co':
      return 'co'
    case 'sb':
      return 'sb'
    case 'bb':
      return 'bb'
    case 'utg':
    case 'utg1':
    case 'utg2':
      return 'ep'
    case 'mp':
    case 'lj':
    case 'hj':
      return 'mp'
    default:
      return 'unknown'
  }
}

export const stageToStreet = (
  stage: string
): 'preflop' | 'flop' | 'turn' | 'river' => {
  if (stage === 'flop') return 'flop'
  if (stage === 'turn') return 'turn'
  if (stage === 'river') return 'river'
  return 'preflop'
}
