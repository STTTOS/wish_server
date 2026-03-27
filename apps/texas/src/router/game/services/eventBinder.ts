import type { BindTexasLifecycleParams } from './types'

import { logger } from '../../../logger'
import {
  match,
  betRecord,
  matchError,
  room as roomModel,
  matchStageTimeRecord
} from '../../../models'
import {
  registerNextHandHooks,
  cancelNextHandCountdown,
  maybeStartNextHandCountdown
} from '../../../gameRuntime/nextHandCountdown'

/**
 * 绑定 Texas 生命周期事件：
 * 行为事件、阶段推进、结算、下一手倒计时、错误回滚。
 */
export function bindTexasLifecycleEvents(params: BindTexasLifecycleParams) {
  const { texas, roomId, roomKey, roomInfo, runtimeRegistry, wsGateway } =
    params

  const getRuntime = () => runtimeRegistry.getOrThrow(roomKey)

  texas.onError(async (error) => {
    try {
      await matchError.create({
        data: {
          matchId: getRuntime().currentMatchId,
          info: JSON.stringify(error)
        }
      })
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
    const player = texas.room.getPlayerById(userId)
    const serverNow = Date.now()
    const thinkingTimeMs =
      (player?.thinkingTime ?? roomInfo.thinkingTime) * 1000
    wsGateway.notifyActionRequired(roomKey, {
      matchId: getRuntime().currentMatchId,
      userId,
      serverNow,
      deadlineAt: serverNow + thinkingTimeMs,
      allowedActions,
      restrict
    })
  })

  texas.onAction(async (player) => {
    const action = player.getAction()!
    const actionType = action.type
    const amount = Number(action.payload?.value ?? 0)
    await betRecord.create({
      data: {
        userId: player.getUserInfo().id,
        actionType,
        amount,
        stage: texas.controller.stage,
        matchId: getRuntime().currentMatchId
      }
    })
    wsGateway.notifyActionTaken(roomKey, {
      matchId: getRuntime().currentMatchId,
      userId: player.getUserInfo().id,
      actionType,
      amount,
      pool: texas.pool.totalAmount,
      currentStageBetAmount: player.currentStageTotalAmount,
      balance: player.balance
    })
  })

  texas.onNextStage(async ({ stage, commonPokes, lastStage }) => {
    await matchStageTimeRecord.update({
      where: {
        matchId_stage: {
          matchId: getRuntime().currentMatchId,
          stage: lastStage
        }
      },
      data: { endAt: new Date() }
    })
    await matchStageTimeRecord.create({
      data: { matchId: getRuntime().currentMatchId, stage }
    })
    wsGateway.notifyStageChanged(roomKey, {
      matchId: getRuntime().currentMatchId,
      stage,
      pokesToReveal: commonPokes
    })
  })

  texas.onGameStart(async () => {
    await matchStageTimeRecord.create({
      data: { matchId: getRuntime().currentMatchId, stage: 'pre_flop' }
    })
    wsGateway.notifyGameStart(roomKey, {
      matchId: getRuntime().currentMatchId,
      stage: texas.controller.stage,
      pool: texas.pool.totalAmount,
      defaultBets: texas.getDefaultBet().map((b) => ({
        userId: b.userId,
        amount: b.amount,
        balance: b.balance
      }))
    })
  })

  registerNextHandHooks(roomId, {
    canStart: () =>
      (texas.controller.status as unknown as string) === 'idle' &&
      texas.room.getPlayersBySeatStatus('on-set').length >= 2,
    onLock: async () => {
      const next = await match.create({
        data: {
          roomId,
          lowestBetAmount: roomInfo.lowestBetAmount,
          startedAt: new Date()
        }
      })
      runtimeRegistry.setCurrentMatchId(roomKey, next.id)
      await roomModel.update({
        where: { id: roomId },
        data: { gameStatus: 'between_hands' }
      })
      texas.resetBeforeGameStart()
      texas.setPlayerRoles()
      getRuntime().rollbackManager.snapshotPlayersAtHandStart(
        getRuntime().currentMatchId
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

  texas.onGameEnd((params) => {
    void (async () => {
      try {
        texas.settle()
        const currentMatchId = getRuntime().currentMatchId
        const seated = texas.room.getPlayersBySeatStatus('on-set')
        const strengthSorted = seated
          .filter((p) => p.getStatus() !== 'out')
          .map((p) => p.rankStrength)
          .sort((a, b) => b - a)
        const rankOf = (strength: number) =>
          Math.max(1, strengthSorted.indexOf(strength) + 1)
        const bestRankCategory =
          params.bestRankCategory ??
          seated.find((p) => p.rankCategory)?.rankCategory
        if (!bestRankCategory) {
          throw new Error('bestRankCategory missing on game end')
        }
        const settleList = seated.map((p) => ({
          userId: p.getUserInfo().id,
          balance: p.balance,
          wager: p.wager,
          rank: rankOf(p.rankStrength),
          isAllIn: p.getStatus() === 'allIn',
          isFold: p.getStatus() === 'out',
          handPokes: p.getHandPokes(),
          rankCategory: p.rankCategory ?? bestRankCategory
        }))
        const commonPokes = texas.dealer.deck.getPokes().commonPokes
        await match.update({
          where: { id: currentMatchId },
          data: {
            endedAt: new Date(),
            endStage: params.currentStage,
            commonPokes,
            bestRankCategory,
            bestPokes: params.bestPokes ?? undefined,
            totalBetAmount: seated.reduce(
              (s, p) => s + (p.totalBetAmount ?? 0),
              0
            )
          }
        })
        wsGateway.notifyGameEnd(roomKey, {
          matchId: currentMatchId,
          settleList,
          pokesToReveal: commonPokes,
          endStage: params.currentStage,
          bestRankCategory,
          gameDuration: Math.floor(
            (Date.now() - getRuntime().matchStartedAt) / 1000
          ),
          bestPokes: params.bestPokes ?? [],
          totalBetAmount: seated.reduce(
            (s, p) => s + (p.totalBetAmount ?? 0),
            0
          )
        })

        if (texas.room.getPlayersBySeatStatus('on-set').length < 2) {
          cancelNextHandCountdown(roomId)
          await getRuntime().rollbackManager.invalidateAndRollbackMatch(
            'insufficient_players',
            '对局结束时在座人数不足2人，本手作废'
          )
        } else {
          getRuntime().rollbackManager.clearInvalidatedFlag(currentMatchId)
          getRuntime().rollbackManager.clearSnapshot(currentMatchId)
        }

        await roomModel.update({
          where: { id: roomId },
          data: { gameStatus: 'between_hands' }
        })
        maybeStartNextHandCountdown(roomId)
      } catch (e) {
        logger.error('onGameEnd handler failed', e)
      }
    })()
  })

  texas.onRolesAssigned(({ players }) => {
    wsGateway.notifyRolesAssigned(
      roomKey,
      getRuntime().currentMatchId,
      players.map((p) => ({ userId: p.userId, role: p.role }))
    )
  })

  texas.onDealCards(({ players }) => {
    players.forEach((p) => {
      wsGateway.notifyHandDealtToUser(p.userId, {
        matchId: getRuntime().currentMatchId,
        roomId,
        handPokes: p.handPokes
      })
    })
  })
}
