import type { GameRuntime } from '../runtimeRegistry'

import { TexasError } from 'texas-poker-core'
import { Prisma } from '@prisma/texas-client'

import prisma from '../../../../models'
import { logger } from '../../../../logger'
import { GameWsGateway } from '../gameWsGateway'
import { gameRuntimeRegistry } from '../runtimeRegistry'
import { engineFatalIncident } from '../../../../models'
import {
  cancelNextHandCountdown,
  unregisterNextHandHooks
} from '../../../../gameRuntime/nextHandCountdown'

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
  const wsGateway = new GameWsGateway()
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

  const runtime = getRuntime()
  const trackedUserIds = new Set<number>([
    ...runtime.texas.room.getAllPlayers().map((p) => p.getUserInfo().id)
  ])
  try {
    const memberRows = await prisma.roomMember.findMany({
      where: { roomId },
      select: { userId: true }
    })
    memberRows.forEach((m) => trackedUserIds.add(m.userId))
    await prisma.$transaction(async (tx) => {
      await tx.room.update({
        where: { id: roomId },
        data: {
          deletedAt: new Date(),
          activeOwnerId: null,
          activeCode: null
        }
      })
      await tx.roomMember.deleteMany({ where: { roomId } })
    })
  } catch (e) {
    logger.error('[fatal texas] room dissolution failed', e)
  }

  wsGateway.broadcastRoomListRoomDeleted(roomId)
  for (const userId of trackedUserIds) {
    wsGateway.disconnectUserRoomSockets(roomId, userId)
  }
  try {
    cancelNextHandCountdown(roomId)
    unregisterNextHandHooks(roomId)
  } catch (e) {
    logger.error('[fatal texas] clear countdown/hooks failed', e)
  }
  gameRuntimeRegistry.destroyRuntime(roomKey)
  logger.error(
    `[fatal texas] roomKey=${roomKey} matchId=${matchIdForLog ?? 'null'}`,
    error
  )
}
