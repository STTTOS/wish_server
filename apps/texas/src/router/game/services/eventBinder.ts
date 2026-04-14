import type { BindTexasLifecycleParams } from './types'

import { TexasError, isFatalTexasErrorCode } from 'texas-poker-core'

import { match, room as roomModel } from '../../../models'
import { autoTopUpOnSeatPlayersAtHandLock } from './chipTopUpUseCase'
import { buildTexasEventContext } from './texasDomain/texasEventContext'
import { drainAndInterpretTexas } from './texasDomain/drainTexasDomainEvents'
import { registerNextHandHooks } from '../../../gameRuntime/nextHandCountdown'
import { handleFatalTexasEngineError } from './texasDomain/handleFatalTexasEngineError'

/**
 * 注册局间倒计时钩子，并返回领域事件排空函数（持久化 / WS / `pendingFlowOps` 节拍）。
 * Core 固定经 `pendingFlowOps` 延迟进街与交权；由 `drainAndInterpretTexas` 消费并带可配置 sleep。
 */
export function bindTexasLifecycleEvents(params: BindTexasLifecycleParams): {
  drainTexasDomainEvents: () => Promise<void>
} {
  const { texas, roomId, roomKey, roomInfo, runtimeRegistry, wsGateway } =
    params

  const getRuntime = () => runtimeRegistry.getOrThrow(roomKey)
  const ctx = buildTexasEventContext({
    texas,
    roomId,
    roomKey,
    roomInfo,
    wsGateway,
    getRuntime
  })
  const drainTexasDomainEvents = () => drainAndInterpretTexas(ctx)

  registerNextHandHooks(roomId, {
    canStart: () =>
      (texas.controller.status as unknown as string) === 'idle' &&
      texas.room.getPlayersBySeatStatus('on-set').length >= 2,
    onLock: async () => {
      await autoTopUpOnSeatPlayersAtHandLock({
        roomId,
        roomKey,
        texas,
        lowestBetAmount: roomInfo.lowestBetAmount,
        initialChips: roomInfo.initialChips,
        wsGateway
      })
      const next = await match.create({
        data: {
          roomId,
          lowestBetAmount: roomInfo.lowestBetAmount
        }
      })
      await roomModel.update({
        where: { id: roomId },
        data: { gameStatus: 'in_hand' }
      })
      runtimeRegistry.setCurrentMatchId(roomKey, next.id)
      texas.resetBeforeGameStart()
    },
    onAssignRoles: async () => {
      try {
        texas.unlockSeats()
        texas.setPlayerRoles('rotate')
        await drainTexasDomainEvents()
        getRuntime().rollbackManager.snapshotPlayersAtHandStart(
          getRuntime().currentMatchId!
        )
      } catch (e: unknown) {
        if (e instanceof TexasError && isFatalTexasErrorCode(e.code)) {
          await handleFatalTexasEngineError({
            error: e,
            roomId,
            roomKey,
            getRuntime
          })
        }
        throw e
      }
    },
    onDeal: async () => {
      try {
        texas.dealCards()
        await drainTexasDomainEvents()
        getRuntime().rollbackManager.snapshotPlayersAtHandStart(
          getRuntime().currentMatchId!
        )
      } catch (e: unknown) {
        if (e instanceof TexasError && isFatalTexasErrorCode(e.code)) {
          await handleFatalTexasEngineError({
            error: e,
            roomId,
            roomKey,
            getRuntime
          })
        }
        throw e
      }
    },
    onStart: async () => {
      try {
        texas.start()
        await drainTexasDomainEvents()
      } catch (e: unknown) {
        if (e instanceof TexasError && isFatalTexasErrorCode(e.code)) {
          await handleFatalTexasEngineError({
            error: e,
            roomId,
            roomKey,
            getRuntime
          })
        }
        throw e
      }
    }
  })

  return { drainTexasDomainEvents }
}
