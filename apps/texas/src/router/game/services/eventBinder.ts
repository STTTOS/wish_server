import type { BindTexasLifecycleParams } from './types'

import {
  RoleEnum,
  TexasError,
  TexasCoreErrorCode,
  isFatalTexasErrorCode,
  type TexasDomainEvent
} from 'texas-poker-core'

import prisma, { match } from '../../../models'
import { transitionRoomGameStatus } from './stateMachine'
import { applyTopUpPlansAtHandLock } from './chipTopUpUseCase'
import { buildTexasEventContext } from './texasDomain/texasEventContext'
import { dealCardsWithOptionalDevForce27o } from './devForceSevenTwoOffsuit'
import { drainAndInterpretTexas } from './texasDomain/drainTexasDomainEvents'
import { handleFatalTexasEngineError } from './texasDomain/handleFatalTexasEngineError'
import {
  registerNextHandHooks,
  cancelNextHandCountdown,
  unregisterNextHandHooks
} from '../../../gameRuntime/nextHandCountdown'

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

  const canStartNextHandByStatus = (status: unknown): boolean => {
    const normalized = String(status)
    return normalized === 'idle' || normalized === 'between_hands'
  }

  const closeRoomForInsufficientPlayers = async () => {
    // 若倒计时已启动，先广播 cancelled，避免客户端看到“继续开下一手”
    cancelNextHandCountdown(roomId)
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
    wsGateway.notifyGameRoomClosed(roomKey, {
      roomId,
      reason: 'insufficient_players'
    })
    wsGateway.broadcastRoomListRoomDeleted(roomId)
    unregisterNextHandHooks(roomId)
    runtimeRegistry.destroyRuntime(roomKey)
  }

  registerNextHandHooks(roomId, {
    canStart: () =>
      runtimeRegistry.hasTexas(roomKey) &&
      canStartNextHandByStatus(texas.controller.status),
    onLock: async () => {
      setQuitBlocked(true)
      texas.reset()
      // 锁座, 新加入的玩家落到观战席
      texas.lockSeats()
      const seatedCount = texas.room.getPlayersBySeatStatus('on-set').length
      if (seatedCount < 2) {
        await closeRoomForInsufficientPlayers()
        return
      }
      const next = await match.create({
        data: {
          roomId,
          lowestBetAmount: roomInfo.lowestBetAmount
        }
      })
      await transitionRoomGameStatus(roomId, 'starting_hand')
      runtimeRegistry.setCurrentMatchId(roomKey, next.id)
      await applyTopUpPlansAtHandLock({
        roomId,
        roomKey,
        texas,
        lowestBetAmount: roomInfo.lowestBetAmount,
        initialChips: roomInfo.initialChips,
        wsGateway,
        handMatchId: next.id
      })
      const seatedAfterTopUpKick =
        texas.room.getPlayersBySeatStatus('on-set').length
      if (seatedAfterTopUpKick < 2) {
        await closeRoomForInsufficientPlayers()
        return
      }
    },
    onAssignRoles: async () => {
      try {
        // 根据新加入/离开的玩家 重排位置, 并将位置信息推送给客户端
        const roleEvents = texas.setPlayerRoles('rearrange')
        await drainTexasDomainEvents(roleEvents)
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
        const dealEvents = dealCardsWithOptionalDevForce27o({
          texas,
          roomId,
          phase: 'next_hand'
        })
        await drainTexasDomainEvents(dealEvents)
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
        const pendingPostBbUserIds =
          runtimeRegistry.consumePendingPostBigBlind(roomKey)
        const posted: Array<{
          userId: number
          amount: number
          balance: number
          totalBetAmount: number
          currentStageBetAmount: number
        }> = []
        for (const userId of pendingPostBbUserIds) {
          const seatStatus = texas.room.getPlayerSeatStatusById(userId)
          if (seatStatus !== 'on-set') continue
          const pl = texas.dealer.getById(userId)
          if (!pl) continue
          const role = pl.getRole()
          if (role === RoleEnum.SB || role === RoleEnum.BB) continue
          try {
            const ev = texas.dispatchCommand({
              type: 'PostBigBlind',
              playerId: userId
            })
            const postedEv = ev.find((x) => x.type === 'PostedBigBlind')
            if (postedEv?.type === 'PostedBigBlind') {
              posted.push({
                userId,
                amount: postedEv.payload.amount,
                balance: pl.balance,
                totalBetAmount: pl.totalBetAmount,
                currentStageBetAmount: pl.currentStageTotalAmount
              })
            }
            await drainTexasDomainEvents(ev)
          } catch (err: unknown) {
            if (
              err instanceof TexasError &&
              err.code === TexasCoreErrorCode.CTRL_POST_BB_IS_ACTIVE_PLAYER
            ) {
              continue
            }
            throw err
          }
        }
        if (posted.length > 0) {
          wsGateway.notifyPlayersPostedBigBlind(roomKey, {
            roomId,
            matchId: getRuntime().currentMatchId,
            seatedUserIds: [],
            posts: posted,
            pool: texas.pool.totalAmount
          })
        }
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
