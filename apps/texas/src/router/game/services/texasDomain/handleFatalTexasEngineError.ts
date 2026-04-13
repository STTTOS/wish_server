import type { GameRuntime } from '../runtimeRegistry'

import { TexasError } from 'texas-poker-core'

import { logger } from '../../../../logger'
import { matchError, room as roomModel } from '../../../../models'
import { maybeStartNextHandCountdown } from '../../../../gameRuntime/nextHandCountdown'

export async function handleFatalTexasEngineError(params: {
  error: TexasError
  roomId: number
  roomKey: string
  getRuntime: () => GameRuntime
}): Promise<void> {
  const { error, roomId, roomKey, getRuntime } = params
  const matchIdForLog = getRuntime().currentMatchId
  try {
    if (matchIdForLog != null) {
      await matchError.create({
        data: {
          matchId: matchIdForLog,
          info: JSON.stringify(error)
        }
      })
    }
  } catch (e) {
    logger.error('write matchError failed', e)
  }
  await getRuntime().rollbackManager.invalidateAndRollbackMatch(
    'engine_error',
    error?.message ?? '引擎异常，对局已作废'
  )
  await roomModel.update({
    where: { id: roomId },
    data: { gameStatus: 'between_hands' }
  })
  maybeStartNextHandCountdown(roomId)
  logger.error(`[fatal texas] roomKey=${roomKey}`, error)
}
