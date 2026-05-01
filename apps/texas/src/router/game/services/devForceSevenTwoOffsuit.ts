import type { Texas, TexasDomainEvent } from 'texas-poker-core'

import { logger } from '../../../logger'

const DEV_FORCE_27O_USER_ID = Number(
  process.env.TEXAS_DEV_FORCE_27O_USER_ID ?? Number.NaN
)
const DEV_FORCE_27O_MAX_RETRIES = Math.max(
  0,
  Math.floor(Number(process.env.TEXAS_DEV_FORCE_27O_MAX_RETRIES ?? 200))
)

function isSevenTwoOffsuit(handPokes: readonly string[]): boolean {
  if (handPokes.length !== 2) return false
  const [a, b] = handPokes
  if (a.length < 2 || b.length < 2) return false
  const suitA = a[0]
  const rankA = a.slice(1)
  const suitB = b[0]
  const rankB = b.slice(1)
  if (suitA === suitB) return false
  return (rankA === '2' && rankB === '7') || (rankA === '7' && rankB === '2')
}

function getDevForceTargetUserId(): number | null {
  if (process.env.NODE_ENV === 'production') return null
  if (!Number.isFinite(DEV_FORCE_27O_USER_ID) || DEV_FORCE_27O_USER_ID <= 0) {
    return null
  }
  return DEV_FORCE_27O_USER_ID
}

export function dealCardsWithOptionalDevForce27o(params: {
  texas: Texas
  roomId: number
  phase: 'start_game' | 'next_hand'
}): TexasDomainEvent[] {
  const { texas, roomId, phase } = params
  let dealEvents = texas.dealCards()

  const targetUserId = getDevForceTargetUserId()
  if (targetUserId == null) return dealEvents

  const targetPlayer = texas.dealer.getById(targetUserId)
  if (!targetPlayer) {
    logger.warn(
      `[dev-force-27o] target user not on seat, skip forcing roomId=${roomId} phase=${phase} userId=${targetUserId}`
    )
    return dealEvents
  }

  if (isSevenTwoOffsuit(targetPlayer.getHandPokes())) {
    return dealEvents
  }

  for (let i = 0; i < DEV_FORCE_27O_MAX_RETRIES; i++) {
    dealEvents = texas.dealCards()
    if (isSevenTwoOffsuit(targetPlayer.getHandPokes())) {
      logger.info(
        `[dev-force-27o] forced success roomId=${roomId} phase=${phase} userId=${targetUserId} retries=${
          i + 1
        }`
      )
      return dealEvents
    }
  }

  logger.warn(
    `[dev-force-27o] forced failed roomId=${roomId} phase=${phase} userId=${targetUserId} maxRetries=${DEV_FORCE_27O_MAX_RETRIES}`
  )
  return dealEvents
}
