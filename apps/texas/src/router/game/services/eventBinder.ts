import type { Player } from 'texas-poker-core'
import type { BindTexasLifecycleParams } from './types'
import type { WsMatchOverview } from '../../../ws/ws-event-types'

import { Prisma } from '@prisma/texas-client'
import { isFatalTexasErrorCode } from 'texas-poker-core'

import { logger } from '../../../logger'
import { autoTopUpOnSeatPlayersAtHandLock } from './chipTopUpUseCase'
import { fetchMatchOverviewForRoom } from './matchOverviewAggregation'
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
    /** lockAt：建局、重置引擎、房间视为已开局（坐席已锁） */
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
      // 先写 DB 为 in_hand，再 setCurrentMatchId，避免极短窗口内「房间仍 between_hands 但 runtime 已指向新局」，
      // 导致局间亮上一手（showMyHandPokes）误判 runtimeMatchId !== matchId。
      await roomModel.update({
        where: { id: roomId },
        data: { gameStatus: 'in_hand' }
      })
      runtimeRegistry.setCurrentMatchId(roomKey, next.id)
      texas.resetBeforeGameStart()
    },
    onAssignRoles: async () => {
      // 这里需要校验玩家的余额
      // 同时还需要将玩家的余额实时写进room  Member 表中
      texas.unlockSeats()
      texas.setPlayerRoles('rotate')
      await getRuntime().rolesAssignedPersistence
      getRuntime().rollbackManager.snapshotPlayersAtHandStart(
        getRuntime().currentMatchId!
      )
    },
    onDeal: () => {
      texas.dealCards()
      getRuntime().rollbackManager.snapshotPlayersAtHandStart(
        getRuntime().currentMatchId!
      )
    },
    onStart: async () => {
      await texas.controller.start()
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
    const thinkingTimeMs = roomInfo.thinkingTime * 1000
    wsGateway.notifyActionRequired(roomKey, {
      matchId,
      userId,
      deadlineAt: serverNow + thinkingTimeMs,
      allowedActions,
      restrict,
      serverNow
    })
  })

  texas.onAction(async (player) => {
    const matchId = getRuntime().currentMatchId
    if (matchId == null) return
    const action = player.getAction()!
    const actionType = action.type
    const amount = Number(action.payload?.value ?? 0)
    const data = await betRecord.create({
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
      actionId: data.id,
      actionType,
      amount,
      pool: texas.pool.totalAmount,
      totalBetAmount: player.totalBetAmount,
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
      matchId
    })
  })

  texas.onGameEnd(
    ({
      endStage,
      bestPokes,
      currentStage,
      showHandPokes,
      pokesToReveal,
      bestRankCategory,
      pokesRevealed
    }) => {
      void (async () => {
        try {
          const gameEndAt = new Date()
          const currentMatchId = getRuntime().currentMatchId
          if (currentMatchId == null) {
            logger.error('onGameEnd skipped: currentMatchId is null')
            return
          }
          texas.settle()
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

          /** 未弃牌人数；为 1 时即独收池，该人 isFold=false，其余在坐者均已弃牌，故无需再写「且为本人」 */
          const unfoldedOnSetCount = seated.filter(
            (x) => x.getStatus() !== 'out'
          ).length

          const buildSettleListForViewer = (viewerUserId: number) =>
            sortedSeated.map((p) => {
              const userId = p.getUserInfo().id
              const isFold = p.getStatus() === 'out'
              let handPokes = p.getHandPokes()
              const hideHoleFromViewer =
                viewerUserId !== userId && (isFold || !showHandPokes)
              if (hideHoleFromViewer) {
                handPokes = []
              }
              return {
                userId,
                balance: p.balance,
                wager: p.wager,
                isAllIn: p.getStatus() === 'allIn',
                isFold,
                canVoluntaryShowHand: isFold || unfoldedOnSetCount === 1,
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
          await match.update({
            where: { id: currentMatchId },
            data: {
              commonPokes: pokesRevealed,
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
                isAllIn,
                balanceAfterHand: Math.round(p.balance)
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

          let matchOverview: WsMatchOverview = { wagerList: [], billList: [] }
          try {
            matchOverview = await fetchMatchOverviewForRoom(roomId, texas)
          } catch (overviewErr) {
            logger.error(
              '[onGameEnd] fetchMatchOverviewForRoom failed',
              overviewErr
            )
          }

          wsGateway.notifyGameEndPerViewer(roomKey, (viewerUserId) => ({
            matchId: currentMatchId,
            settleList: buildSettleListForViewer(viewerUserId),
            matchOverview,
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
          // 将游戏状态重置为 idle
          texas.controller.reset()
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
        wsGateway.notifyRolesAssigned(roomKey, {
          matchId: currentMatchId,
          roles: players.map((p) => ({
            userId: p.userId,
            role: p.role,
            actionIndex: p.actionIndex
          }))
        })
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
