/* eslint-disable camelcase */
import router from '../instance'
import { roomMember } from '../../models'
import response from '../../utils/response'
import combinePath from '../../utils/combinePath'
import { StartGameUseCase } from './services/flow'
import { apiPrefixWeb, apiPrefixClient } from '../../config'
import {
  gameRuntimeRegistry,
  getCurrentMatchIdWithFallback
} from './services/runtimeKit'
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
const startGameUseCase = new StartGameUseCase()

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

  const requested = await startGameUseCase.requestStart(roomId, ownerId)
  if (!requested.ok) {
    response.error(ctx, requested.code, requested.msg)
    return
  }

  // HTTP 立即返回：后续开局流程在后台异步推进
  response.success(ctx, { roomId }, '进入游戏中')
  startGameUseCase.runStartFlowInBackground(requested.data)

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
  const texas = roomId
    ? gameRuntimeRegistry.getTexas(String(roomId))
    : undefined
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
  const currentMatchId = await getCurrentMatchIdWithFallback(roomId)
  const matchInfo = {
    matchId: currentMatchId,
    roomId: Number(roomId),
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
