import type { BindTexasLifecycleParams } from './types'

import {
  TexasError,
  isFatalTexasErrorCode,
  type TexasDomainEvent
} from 'texas-poker-core'

import { match } from '../../../models'
import { transitionRoomGameStatus } from './stateMachine'
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
  drainTexasDomainEvents: (
    preEvents?: readonly TexasDomainEvent[]
  ) => Promise<void>
} {
  const { texas, roomId, roomKey, roomInfo, runtimeRegistry, wsGateway } =
    params

  const setQuitBlocked = (blocked: boolean) =>
    runtimeRegistry.setQuitBlockedUntilBlindsPosted(roomKey, blocked)

  const getRuntime = () => runtimeRegistry.getOrThrow(roomKey)
  const ctx = buildTexasEventContext({
    texas,
    roomId,
    roomKey,
    roomInfo,
    wsGateway,
    getRuntime
  })
  const drainTexasDomainEvents = (preEvents?: readonly TexasDomainEvent[]) =>
    drainAndInterpretTexas(ctx, preEvents?.length ? { preEvents } : undefined)

  registerNextHandHooks(roomId, {
    canStart: () =>
      (texas.controller.status as unknown as string) === 'idle' &&
      texas.room.getPlayersBySeatStatus('on-set').length >= 2,
    onLock: async () => {
      setQuitBlocked(true)
      texas.reset()
      // 锁座, 新加入的玩家落到观战席
      texas.lockSeats()
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
      await transitionRoomGameStatus(roomId, 'starting_hand')
      runtimeRegistry.setCurrentMatchId(roomKey, next.id)
    },
    onAssignRoles: async () => {
      try {
        // 根据新加入/离开的玩家 重排位置, 并将位置信息推送给客户端
        const roleEvents = texas.setPlayerRoles('rearrange')
        await drainTexasDomainEvents(roleEvents)
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
        const dealEvents = texas.dealCards()
        await drainTexasDomainEvents(dealEvents)
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
        const startEvents = texas.start()
        await drainTexasDomainEvents(startEvents)
        await transitionRoomGameStatus(roomId, 'in_hand')
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
