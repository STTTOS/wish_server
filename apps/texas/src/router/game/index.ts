/* eslint-disable camelcase */

/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ActionType } from 'texas-poker-core'
import type { WsMessage } from '../../ws/ws-event-types'

import { Texas } from 'texas-poker-core'

import router from '../instance'
import { ws } from '../../server'
import { logger } from '../../logger'
import response from '../../utils/response'
import combinePath from '../../utils/combinePath'
import { getGame, createGame } from '../../gameCenter'
import { apiPrefixWeb, apiPrefixClient } from '../../config'
import { roomMember, room as roomModel } from '../../models'
import {
  match,
  betRecord,
  matchError,
  playerMatchRecord,
  matchStageTimeRecord
} from '../../models'
import {
  registerNextHandHooks,
  cancelNextHandCountdown,
  maybeStartNextHandCountdown
} from '../../gameCenter/nextHandCountdown'
import {
  MIN_BB,
  MAX_PLAYERS_COUNT,
  MIN_THINKING_TIME,
  EXTENDED_THINKING_TIME,
  MAX_DELAY_REQUEST_COUNT,
  INITIAL_CHIPS_MIN_BB_MULTIPLIER
} from '../../constants/game'

const toolsApi = combinePath(apiPrefixWeb)('/game')
const gameClientApi = combinePath(apiPrefixClient)('/game')

// 客户端：获取游戏基础配置, 使用get方法, 客户端缓存
router.get(gameClientApi('/config'), async (ctx) => {
  response.success(ctx, {
    minThinkingTime: MIN_THINKING_TIME,
    initialChipsMinBigBlindMultiplier: INITIAL_CHIPS_MIN_BB_MULTIPLIER,
    maxPlayersCount: MAX_PLAYERS_COUNT,
    minBB: MIN_BB,
    maxDelayRequestCount: MAX_DELAY_REQUEST_COUNT,
    extendedThinkingTime: EXTENDED_THINKING_TIME
  })
})

// 以下开始新增接口

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * 客户端：房主点击开始游戏（进入对局）
 * url: client/game/entring
 * body: { roomId: number }
 */
router.post(gameClientApi('/entring'), async (ctx) => {
  const { roomId }: { roomId?: number } = ctx.request.body ?? {}
  const ownerId = ctx.state.user!.id
  if (!roomId || !Number.isInteger(roomId)) {
    response.error(ctx, 400, '参数异常：需要 roomId')
    return
  }

  const roomInfo = await roomModel.findUnique({
    where: { id: roomId },
    include: { owner: true }
  })
  if (!roomInfo || roomInfo.deletedAt) {
    response.error(ctx, 2000, '房间不存在')
    return
  }
  if (roomInfo.ownerId !== ownerId) {
    response.error(ctx, 403, '仅房主可开始游戏')
    return
  }
  const roomGameStatus = (roomInfo as unknown as { gameStatus?: string })
    .gameStatus
  if (roomGameStatus !== 'waiting') {
    response.error(ctx, 2100, '房间已开始或正在进入游戏中')
    return
  }

  const members = await roomMember.findMany({
    where: { roomId },
    include: { user: true },
    orderBy: { joinedAt: 'asc' }
  })
  if (members.length < 2) {
    response.error(ctx, 2100, '人数不足，无法开始游戏')
    return
  }

  // 进入对局：更新房间状态 & 通知等待房间内所有玩家去建立 /game namespace 连接
  await roomModel.update({
    where: { id: roomId },
    data: { gameStatus: 'entering' } as unknown as any
  })

  const enteringMsg: WsMessage<'game-entering'> = {
    type: 'game-entering',
    data: { roomId }
  }
  ws.broadcastWaitingRoom(roomId, enteringMsg)

  const roomKey = String(roomId)
  const userIds = members.map((m) => m.userId)

  // 开始追踪进入进度（等待房间 WS 会持续收到 game-entering-progress）
  ws.trackGameEntering(roomId, userIds)

  // HTTP 立即返回：后续开局流程在后台异步推进
  response.success(ctx, { roomId }, '进入游戏中')

  void (async () => {
    try {
      // 等待所有玩家完成 /game namespace 连接（客户端需用 query.roomId=roomId）
      await ws.waitForGameUsersConnected(roomKey, userIds, {
        timeoutMs: 20_000
      })
      ws.untrackGameEntering(roomId)

      // 实例化 Texas（业务层负责 join/seat/ready/开局）
      const texas = new Texas({
        lowestBetAmount: roomInfo.lowestBetAmount,
        maximumCountOfPlayers: members.length,
        initialChips: roomInfo.initialChips,
        thinkingTime: roomInfo.thinkingTime,
        user: { id: roomInfo.owner.id, name: roomInfo.owner.name }
      })

      // 将房间成员加入并全部入座
      const ownerPlayer = texas.room.owner
      texas.room.seat(ownerPlayer)
      for (const m of members) {
        if (m.userId === ownerId) continue
        const p = texas.createPlayer({ id: m.user.id, name: m.user.name })
        texas.room.join(p)
        texas.room.seat(p)
      }

      // 创建对局 Match（startedAt/lowestBetAmount/roomId）
      const matchInfo = await match.create({
        data: {
          roomId,
          lowestBetAmount: roomInfo.lowestBetAmount,
          startedAt: new Date()
        }
      })
      let currentMatchId = matchInfo.id

      // 通知等待房间：已进入游戏（可跳转到 /game 页面）
      const enteredMsg: WsMessage<'game-entered'> = {
        type: 'game-entered',
        data: { roomId, matchId: currentMatchId }
      }
      ws.broadcastWaitingRoom(roomId, enteredMsg)

      // 将 Texas 实例挂到 gameCenter（用于 action/currentState 等接口）
      createGame(roomKey, texas)

      const matchStartedAt = Date.now()
      const invalidatedMatchIds = new Set<number>()
      const matchStartSnapshots = new Map<
        number,
        Array<{ userId: number; role: any | null; balance: number }>
      >()

      const snapshotPlayersAtHandStart = (matchId: number) => {
        const players = texas.room.getPlayersBySeatStatus('on-set')
        const snapshot = players.map((p) => ({
          userId: p.getUserInfo().id,
          role: p.getRole(),
          balance: p.balance
        }))
        matchStartSnapshots.set(matchId, snapshot)
      }
      // 首手预置快照：即便在 setPlayerRoles 前作废，也能返回开局前余额
      snapshotPlayersAtHandStart(currentMatchId)

      const invalidateAndRollbackMatch = async (
        source: 'engine_error' | 'insufficient_players',
        reason: string
      ) => {
        const matchIdToInvalidate = currentMatchId
        if (
          !matchIdToInvalidate ||
          invalidatedMatchIds.has(matchIdToInvalidate)
        ) {
          return
        }
        invalidatedMatchIds.add(matchIdToInvalidate)

        try {
          // 回滚到“本手开始之前”：删除本手所有明细与 match 主记录
          await Promise.all([
            matchStageTimeRecord.deleteMany({
              where: { matchId: matchIdToInvalidate }
            }),
            betRecord.deleteMany({ where: { matchId: matchIdToInvalidate } }),
            playerMatchRecord.deleteMany({
              where: { matchId: matchIdToInvalidate }
            }),
            matchError.deleteMany({ where: { matchId: matchIdToInvalidate } })
          ])
          await match.delete({ where: { id: matchIdToInvalidate } })
        } catch (rollbackErr) {
          logger.error('[match-invalidated] rollback failed', rollbackErr)
        }

        const snapshot = matchStartSnapshots.get(matchIdToInvalidate)
        if (snapshot) {
          // 回滚 Texas 内存态：将玩家余额恢复到本手开始时
          snapshot.forEach((s) => {
            const player = texas.room.getPlayerById(s.userId)
            if (player) player.balance = s.balance
          })
        } else {
          logger.error(
            `[match-invalidated] missing start snapshot, matchId=${matchIdToInvalidate}`
          )
        }

        const invalidatedMsg: WsMessage<'game-invalidated'> = {
          type: 'game-invalidated',
          data: {
            roomId,
            matchId: matchIdToInvalidate,
            reason,
            source,
            players:
              snapshot ??
              texas.room.getPlayersBySeatStatus('on-set').map((p) => ({
                userId: p.getUserInfo().id,
                role: (p.getRole() as any) ?? null,
                balance: p.balance
              }))
          }
        }
        ws.broadcast(roomKey, invalidatedMsg)
        matchStartSnapshots.delete(matchIdToInvalidate)
      }

      texas.onError(async (error) => {
        try {
          await matchError.create({
            data: { matchId: currentMatchId, info: JSON.stringify(error) }
          })
        } catch (e) {
          logger.error('write matchError failed', e)
        }
        await invalidateAndRollbackMatch(
          'engine_error',
          error?.message ?? '引擎异常，对局已作废'
        )
        await roomModel.update({
          where: { id: roomId },
          data: { gameStatus: 'between_hands' } as unknown as any
        })
        // 回滚后尝试自动开局（人数不足时会自动取消倒计时并推送取消消息）
        maybeStartNextHandCountdown(roomId)
        // 不要在事件回调里 throw：会导致未处理异常/Promise rejection，影响进程稳定性
        logger.error('[texas.onError]', error)
      })

      // 轮到玩家行动（广播给所有玩家，客户端可显示“谁在行动 + 倒计时 + 可行动列表/限制”）
      texas.onPreAction(({ userId, restrict, allowedActions }) => {
        const player = texas.room.getPlayerById(userId)
        const serverNow = Date.now()
        const thinkingTimeMs =
          (player?.thinkingTime ?? roomInfo.thinkingTime) * 1000
        const deadlineAt = serverNow + thinkingTimeMs
        const msg: WsMessage<'player-action-required'> = {
          type: 'player-action-required',
          data: {
            matchId: currentMatchId,
            userId,
            serverNow,
            deadlineAt,
            allowedActions,
            restrict
          }
        }
        ws.broadcast(roomKey, msg)
      })

      // 玩家已行动（记录 BetRecord + 广播）
      texas.onAction(async (player) => {
        const action = player.getAction()
        const actionType = (action?.type ?? 'check') as ActionType
        const amount = Number(action?.payload?.value ?? 0)

        await betRecord.create({
          data: {
            userId: player.getUserInfo().id,
            actionType,
            amount,
            stage: texas.controller.stage,
            matchId: currentMatchId
          }
        })

        const msg: WsMessage<'player-action-taken'> = {
          type: 'player-action-taken',
          data: {
            matchId: currentMatchId,
            userId: player.getUserInfo().id,
            actionType,
            amount,
            pool: texas.pool.totalAmount,
            currentStageBetAmount: player.currentStageTotalAmount,
            balance: player.balance
          }
        }
        ws.broadcast(roomKey, msg)
      })

      // 阶段推进（翻公共牌）
      texas.onNextStage(async ({ stage, commonPokes, lastStage }) => {
        // 更新上一个阶段结束时间，记录新阶段开始时间
        await matchStageTimeRecord.update({
          where: {
            matchId_stage: {
              matchId: currentMatchId,
              stage: lastStage
            }
          },
          data: { endAt: new Date() }
        })
        await matchStageTimeRecord.create({
          data: { matchId: currentMatchId, stage }
        })

        const msg: WsMessage<'game-stage-changed'> = {
          type: 'game-stage-changed',
          data: { matchId: currentMatchId, stage, pokesToReveal: commonPokes }
        }
        ws.broadcast(roomKey, msg)
      })

      // 小盲/大盲已下，hand 正式开始（用于创建 pre_flop 计时记录 + 广播）
      texas.onGameStart(async () => {
        await matchStageTimeRecord.create({
          data: { matchId: currentMatchId, stage: 'pre_flop' }
        })

        const msg: WsMessage<'game-start'> = {
          type: 'game-start',
          data: {
            matchId: currentMatchId,
            stage: texas.controller.stage,
            pool: texas.pool.totalAmount,
            defaultBets: texas.getDefaultBet().map((b) => ({
              userId: b.userId,
              amount: b.amount,
              balance: b.balance
            }))
          }
        }
        ws.broadcast(roomKey, msg)
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
          currentMatchId = next.id
          await roomModel.update({
            where: { id: roomId },
            data: { gameStatus: 'between_hands' } as unknown as any
          })
          texas.resetBeforeGameStart()
          texas.setPlayerRoles()
          snapshotPlayersAtHandStart(currentMatchId)
        },
        onDeal: () => texas.dealCards(),
        onStart: async () => {
          await texas.controller.start()
          await roomModel.update({
            where: { id: roomId },
            data: { gameStatus: 'in_hand' } as unknown as any
          })
        }
      })

      // 游戏结束（结算、落库、广播）
      texas.onGameEnd((params) => {
        void (async () => {
          try {
            texas.settle()

            const seated = texas.room.getPlayersBySeatStatus('on-set')
            const strengthSorted = seated
              .filter((p) => p.getStatus() !== 'out')
              .map((p) => p.rankStrength)
              .sort((a, b) => b - a)
            const rankOf = (strength: number) =>
              Math.max(1, strengthSorted.indexOf(strength) + 1)

            const settleList = seated.map((p) => ({
              userId: p.getUserInfo().id,
              balance: p.balance,
              wager: p.wager,
              rank: rankOf(p.rankStrength),
              isAllIn: p.getStatus() === 'allIn',
              isFold: p.getStatus() === 'out',
              handPokes: p.getHandPokes(),
              rankCategory: (p.rankSignature?.[0] ??
                params.bestRankCategory) as any
            }))

            const commonPokes = texas.dealer.deck.getPokes().commonPokes
            await match.update({
              where: { id: currentMatchId },
              data: {
                endedAt: new Date(),
                endStage: params.currentStage as any,
                commonPokes,
                bestRankCategory: (params.bestRankCategory as any) ?? null,
                bestPokes: (params.bestPokes ?? undefined) as unknown as any,
                totalBetAmount: seated.reduce(
                  (s, p) => s + (p.totalBetAmount ?? 0),
                  0
                )
              }
            })

            const msg: WsMessage<'game-end'> = {
              type: 'game-end',
              data: {
                matchId: currentMatchId,
                settleList: settleList as any,
                pokesToReveal: commonPokes,
                endStage: params.currentStage as any,
                bestRankCategory: params.bestRankCategory as any,
                gameDuration: Math.floor((Date.now() - matchStartedAt) / 1000),
                bestPokes: (params.bestPokes ?? []) as any,
                totalBetAmount: seated.reduce(
                  (s, p) => s + (p.totalBetAmount ?? 0),
                  0
                )
              }
            }
            ws.broadcast(roomKey, msg)

            if (texas.room.getPlayersBySeatStatus('on-set').length < 2) {
              cancelNextHandCountdown(roomId)
              await invalidateAndRollbackMatch(
                'insufficient_players',
                '对局结束时在座人数不足2人，本手作废'
              )
            } else {
              invalidatedMatchIds.delete(currentMatchId)
              matchStartSnapshots.delete(currentMatchId)
            }

            await roomModel.update({
              where: { id: roomId },
              data: { gameStatus: 'between_hands' } as unknown as any
            })
            // 统一尝试自动开局：人数不足会在 nextHandCountdown 内自动取消并推送取消消息
            maybeStartNextHandCountdown(roomId)
          } catch (e) {
            logger.error('onGameEnd handler failed', e)
          }
        })()
      })

      // 开局前重置（与引擎 start 的 resetBeforeGameStart 对齐，但由业务编排）
      texas.resetBeforeGameStart()

      // 由 core 事件驱动推送：角色分配
      texas.onRolesAssigned(({ players }) => {
        const rolesMsg: WsMessage<'player-roles-assigned'> = {
          type: 'player-roles-assigned',
          data: {
            matchId: currentMatchId,
            roles: players.map((p) => ({
              userId: p.userId,
              role: p.role as any
            }))
          }
        }
        ws.broadcast(roomKey, rolesMsg)
      })

      // 由 core 事件驱动推送：发牌（私牌只发给自己）
      texas.onDealCards(({ players }) => {
        players.forEach((p) => {
          const msg: WsMessage<'player-hand-dealt'> = {
            type: 'player-hand-dealt',
            data: {
              matchId: currentMatchId,
              roomId,
              handPokes: p.handPokes
            }
          }
          ws.broadcastTo(p.userId, msg)
        })
      })

      // 此处按业务分步推进
      texas.setPlayerRoles()
      await delay(2000)

      texas.dealCards()
      await delay(2000)
      snapshotPlayersAtHandStart(currentMatchId)
      await texas.controller.start()

      await roomModel.update({
        where: { id: roomId },
        data: { gameStatus: 'in_hand' } as unknown as any
      })
    } catch (e: any) {
      ws.untrackGameEntering(roomId)
      await roomModel.update({
        where: { id: roomId },
        data: { gameStatus: 'waiting' } as unknown as any
      })
      const failedMsg: WsMessage<'game-entering-failed'> = {
        type: 'game-entering-failed',
        data: { roomId, reason: e?.message ?? '进入游戏失败' }
      }
      ws.broadcastWaitingRoom(roomId, failedMsg)
      logger.error('[entring] start game flow failed', e)
    }
  })()

  return
})

// 用户重连后获取当前对局的状态
router.post(toolsApi('/fetchCurrentGameState'), async (ctx) => {
  const userId = ctx.state.user!.id
  const membership = await roomMember.findFirst({
    where: { userId, room: { deletedAt: null } },
    select: { roomId: true }
  })
  const roomId = membership?.roomId
  const texas = roomId ? getGame(String(roomId)) : undefined
  if (!roomId || !texas) {
    response.success(ctx, 2100, '对局不存在')
    return
  }

  const gameStatus = texas.controller.status
  if ((gameStatus as unknown as string) !== 'in_hand') {
    response.success(ctx, 2100, '游戏已经结束')
    return
  }
  // 需要获取当前对局的信息
  // 包括所有玩家的信息
  // 当前行动的用户的相关信息
  // 当前的阶段, 总奖池

  // 所有玩家的信息
  const playersOnSeat = texas.room
    .getPlayersBySeatStatus('on-set')
    .map((player) => {
      return {
        role: player.getRole(),
        action: player.getAction(),
        userInfo: player.getUserInfo(),
        currentStageTotalAmount: player.currentStageTotalAmount
      }
    })
  const playersOnWatch = texas.room
    .getPlayersBySeatStatus('hang')
    .map((player) => {
      return {
        userInfo: player.getUserInfo()
      }
    })

  const activePlayer = texas.controller.activePlayer
  // 当前行动玩家的信息
  const activePlayerInfo = {
    userInfo: activePlayer?.getUserInfo(),
    remainThinkTime: activePlayer?.getRemainThinkTime()
  }

  // 对局信息
  const matchInfo = {
    status: gameStatus,
    stage: texas.controller.stage,
    pool: texas.pool.totalAmount
  }
  response.success(ctx, {
    playersOnSeat,
    playersOnWatch,
    matchInfo,
    activePlayerInfo
  })
})
