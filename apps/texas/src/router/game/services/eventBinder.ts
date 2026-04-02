import type { Player } from 'texas-poker-core'
import type { BindTexasLifecycleParams } from './types'

import { Prisma } from '@prisma/texas-client'
import { isFatalTexasErrorCode } from 'texas-poker-core'

import { logger } from '../../../logger'
import {
  registerNextHandHooks,
  maybeStartNextHandCountdown
} from '../../../gameRuntime/nextHandCountdown'
import prisma, {
  match,
  betRecord,
  matchError,
  room as roomModel,
  matchStageTimeRecord
} from '../../../models'

function rankSignatureForDb(player: Player): string | null {
  const sig = player.rankSignature
  if (sig == null) return null
  if (typeof sig === 'string') return sig
  return JSON.stringify(sig)
}

/**
 * 绑定 Texas 生命周期事件：
 * 行为事件、阶段推进、结算、下一手倒计时、错误回滚。
 */
export function bindTexasLifecycleEvents(params: BindTexasLifecycleParams) {
  const { texas, roomId, roomKey, roomInfo, runtimeRegistry, wsGateway } =
    params

  const getRuntime = () => runtimeRegistry.getOrThrow(roomKey)

  registerNextHandHooks(roomId, {
    canStart: () =>
      (texas.controller.status as unknown as string) === 'idle' &&
      texas.room.getPlayersBySeatStatus('on-set').length >= 2,
    onLock: async () => {
      const next = await match.create({
        data: {
          roomId,
          lowestBetAmount: roomInfo.lowestBetAmount
        }
      })
      runtimeRegistry.setCurrentMatchId(roomKey, next.id)
      await roomModel.update({
        where: { id: roomId },
        data: { gameStatus: 'between_hands' }
      })
      texas.resetBeforeGameStart()
      texas.setPlayerRoles()
      // 下一手 onLock：必须等本手角色 upsert 落库并 notify 后再打开局快照。
      // dealCards 只在 onLock 全部完成后的定时回调里执行，不会早于这里。
      await getRuntime().rolesAssignedPersistence
      getRuntime().rollbackManager.snapshotPlayersAtHandStart(
        getRuntime().currentMatchId!
      )
    },
    onDeal: () => texas.dealCards(),
    onStart: async () => {
      await texas.controller.start()
      await roomModel.update({
        where: { id: roomId },
        data: { gameStatus: 'in_hand' }
      })
    }
  })

  texas.onError(async (error) => {
    if (!isFatalTexasErrorCode(error.code)) {
      logger.error('non-fatal texas error in game lifecycle', error)
      return
    }

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
    logger.error('[texas.onError]', error)
  })

  texas.onPreAction(({ userId, restrict, allowedActions }) => {
    const matchId = getRuntime().currentMatchId
    if (matchId == null) return
    const serverNow = Date.now()
    const thinkingTimeMs = roomInfo.thinkingTime
    wsGateway.notifyActionRequired(roomKey, {
      matchId,
      userId,
      serverNow,
      deadlineAt: serverNow + thinkingTimeMs,
      allowedActions,
      restrict
    })
  })

  texas.onAction(async (player) => {
    const matchId = getRuntime().currentMatchId
    if (matchId == null) return
    const action = player.getAction()!
    const actionType = action.type
    const amount = Number(action.payload?.value ?? 0)
    await betRecord.create({
      data: {
        userId: player.getUserInfo().id,
        actionType,
        amount,
        stage: texas.controller.stage,
        matchId
      }
    })
    wsGateway.notifyActionTaken(roomKey, {
      matchId,
      userId: player.getUserInfo().id,
      actionType,
      amount,
      pool: texas.pool.totalAmount,
      currentStageBetAmount: player.currentStageTotalAmount,
      balance: player.balance
    })
  })

  texas.onNextStage(async ({ stage, pokesToReveal, lastStage }) => {
    const matchId = getRuntime().currentMatchId
    if (matchId == null) return
    await matchStageTimeRecord.update({
      where: {
        matchId_stage: {
          matchId,
          stage: lastStage
        }
      },
      data: { endAt: new Date() }
    })
    await matchStageTimeRecord.create({
      data: { matchId, stage }
    })
    wsGateway.notifyStageChanged(roomKey, {
      matchId,
      stage,
      pokesToReveal
    })
  })

  texas.onGameStart(async () => {
    const matchId = getRuntime().currentMatchId
    if (matchId == null) return
    await matchStageTimeRecord.create({
      data: { matchId, stage: 'pre_flop' }
    })
    wsGateway.notifyGameStart(roomKey, {
      matchId,
      stage: texas.controller.stage,
      pool: texas.pool.totalAmount,
      defaultBets: texas.getDefaultBet().map((b) => ({
        userId: b.userId,
        amount: b.amount,
        balance: b.balance
      }))
    })
  })

  texas.onGameEnd(
    ({
      endStage,
      bestPokes,
      currentStage,
      // showHandPokes,
      pokesToReveal,
      bestRankCategory
    }) => {
      void (async () => {
        try {
          texas.settle()
          const currentMatchId = getRuntime().currentMatchId
          if (currentMatchId == null) {
            logger.error('onGameEnd skipped: currentMatchId is null')
            return
          }
          const seated = texas.room.getPlayersBySeatStatus('on-set')
          const sortedSeated = [...seated].sort((a, b) => {
            const aFold = a.getStatus() === 'out'
            const bFold = b.getStatus() === 'out'
            if (aFold !== bFold) return aFold ? 1 : -1
            if (aFold && bFold) return b.wager - a.wager
            if (b.rankStrength !== a.rankStrength) {
              return b.rankStrength - a.rankStrength
            }
            return b.wager - a.wager
          })

          const buildSettleListForViewer = (viewerUserId: number) =>
            sortedSeated.map((p) => {
              const userId = p.getUserInfo().id
              const isFold = p.getStatus() === 'out'
              let handPokes = p.getHandPokes()
              const hideHoleFromViewer = viewerUserId !== userId && isFold
              if (hideHoleFromViewer) {
                handPokes = []
              }
              return {
                userId,
                balance: p.balance,
                wager: p.wager,
                isAllIn: p.getStatus() === 'allIn',
                isFold,
                handPokes,
                ...(hideHoleFromViewer
                  ? {
                      rankStrength: 0,
                      rankCategory: undefined
                    }
                  : {
                      rankStrength: p.rankStrength,
                      rankCategory: p.rankCategory
                    })
              }
            })
          const totalBetAmount = texas.pool.totalAmount
          const commonPokes = texas.dealer.deck.getPokes().commonPokes
          const gameEndAt = new Date()
          await match.update({
            where: { id: currentMatchId },
            data: {
              commonPokes,
              bestRankCategory,
              endedAt: gameEndAt,
              lastActionStage: currentStage,
              boardThroughStage: endStage,
              bestPokes,
              totalBetAmount
            }
          })

          await prisma.$transaction(async (tx) => {
            for (const p of seated) {
              const userId = p.getUserInfo().id
              const isFold = p.getStatus() === 'out'
              const isAllIn = p.getStatus() === 'allIn'
              const settleFields = {
                wager: p.wager,
                rankCategory: p.rankCategory ?? null,
                rankSignature: rankSignatureForDb(p),
                rankStrength: p.rankStrength,
                totalBetAmount: Math.round(p.totalBetAmount ?? 0),
                isFold,
                isAllIn
              }
              try {
                await tx.playerMatchRecord.update({
                  where: {
                    matchId_userId: {
                      matchId: currentMatchId,
                      userId
                    }
                  },
                  data: settleFields
                })
              } catch (e) {
                if (
                  e instanceof Prisma.PrismaClientKnownRequestError &&
                  e.code === 'P2025'
                ) {
                  logger.error(
                    `[onGameEnd] playerMatchRecord missing matchId=${currentMatchId} userId=${userId}`
                  )
                } else {
                  throw e
                }
              }
            }
          })

          wsGateway.notifyGameEndPerViewer(roomKey, (viewerUserId) => ({
            matchId: currentMatchId,
            settleList: buildSettleListForViewer(viewerUserId),
            lastActionStage: currentStage,
            boardThroughStage: endStage,
            // 使用 pramas 抛出的剩余公共牌，而不是 texas.dealer.deck.getPokes().commonPokes
            pokesToReveal,
            bestRankCategory,
            gameDuration: Math.floor(
              (gameEndAt.getTime() - getRuntime().matchStartedAt) / 1000
            ),
            // 如果翻牌前除一位玩家都弃牌了, 这个字段本应该为[]
            // 这个是通用属性, 不应该暴露最大玩家的牌
            bestPokes: bestPokes ?? [],
            totalBetAmount
          }))

          getRuntime().rollbackManager.clearInvalidatedFlag(currentMatchId)
          getRuntime().rollbackManager.clearSnapshot(currentMatchId)

          await roomModel.update({
            where: { id: roomId },
            data: { gameStatus: 'between_hands' }
          })
          maybeStartNextHandCountdown(roomId)
        } catch (e) {
          logger.error('onGameEnd handler failed', e)
        }
      })()
    }
  )

  texas.onRolesAssigned(({ players }) => {
    getRuntime().matchStartedAt = Date.now()
    const currentMatchId = getRuntime().currentMatchId
    if (currentMatchId == null) {
      logger.error('onRolesAssigned skipped: currentMatchId is null')
      return
    }

    void match
      .update({
        where: { id: currentMatchId },
        data: { startedAt: new Date() }
      })
      .catch((e) => logger.error('match.startedAt update failed', e))

    const persist = prisma
      .$transaction(
        players.map((p) =>
          prisma.playerMatchRecord.upsert({
            where: {
              matchId_userId: {
                matchId: currentMatchId,
                userId: p.userId
              }
            },
            create: {
              matchId: currentMatchId,
              userId: p.userId,
              role: p.role,
              handPokes: []
            },
            update: { role: p.role }
          })
        )
      )
      .then(() => {
        wsGateway.notifyRolesAssigned(
          roomKey,
          currentMatchId,
          players.map((p) => ({ userId: p.userId, role: p.role }))
        )
      })
      .catch((e) => {
        logger.error('playerMatchRecord create on roles assigned failed', e)
        throw e
      })

    getRuntime().rolesAssignedPersistence = persist
  })

  texas.onDealCards(({ players }) => {
    const matchId = getRuntime().currentMatchId
    if (matchId == null) {
      logger.error('onDealCards skipped: currentMatchId is null')
      return
    }
    void prisma
      .$transaction(
        players.map((p) =>
          prisma.playerMatchRecord.update({
            where: {
              matchId_userId: { matchId, userId: p.userId }
            },
            data: { handPokes: p.handPokes }
          })
        )
      )
      .then(() => {
        getRuntime().rolesAssignedPersistence = Promise.resolve()
        players.forEach((p) => {
          wsGateway.notifyHandDealtToUser(p.userId, {
            matchId,
            roomId,
            handPokes: p.handPokes
          })
        })
      })
      .catch((e) =>
        logger.error('playerMatchRecord handPokes update on deal failed', e)
      )
  })
}
