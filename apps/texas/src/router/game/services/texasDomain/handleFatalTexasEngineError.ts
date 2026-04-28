import type { GameRuntime } from '../runtimeRegistry'

import { TexasError } from 'texas-poker-core'
import { Prisma } from '@prisma/texas-client'

import { logger } from '../../../../logger'
import { gameRuntimeRegistry } from '../runtimeRegistry'
import { room as roomModel, engineFatalIncident } from '../../../../models'
import { cancelNextHandCountdown } from '../../../../gameRuntime/nextHandCountdown'

function fatalErrorPayload(error: TexasError): Prisma.InputJsonValue {
  return {
    code: String(error?.code ?? ''),
    message: error?.message ?? null
  }
}

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
      const msg = (error?.message ?? '引擎异常').slice(0, 512)
      await engineFatalIncident.create({
        data: {
          roomId,
          matchId: matchIdForLog,
          message: msg,
          payload: fatalErrorPayload(error)
        }
      })
    }
  } catch (e) {
    logger.error('[fatal texas] engineFatalIncident insert failed', e)
  }
  await getRuntime().rollbackManager.invalidateAndRollbackMatch(
    error?.message ?? '引擎异常，对局已作废'
  )
  cancelNextHandCountdown(roomId)
  try {
    getRuntime().texas.resetBeforeGameStart()
  } catch (e) {
    logger.error('[fatal texas] resetBeforeGameStart failed', e)
  }
  await roomModel.update({
    where: { id: roomId },
    data: { gameStatus: 'between_hands' }
  })
  gameRuntimeRegistry.setQuitBlockedUntilBlindsPosted(roomKey, false)
  logger.error(
    `[fatal texas] roomKey=${roomKey} matchId=${matchIdForLog ?? 'null'}`,
    error
  )
}
