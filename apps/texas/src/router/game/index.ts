/* eslint-disable camelcase */
import type { ActionType } from 'texas-poker-core'

import router from '../instance'
import response from '../../utils/response'
import { apiPrefixClient } from '../../config'
import { room, roomMember } from '../../models'
import combinePath from '../../utils/combinePath'
import { isAdminUser } from '../../utils/isAdminUser'
import { HTTP_STATUS } from '../../constants/httpStatus'
import { GameWsGateway } from './services/gameWsGateway'
import { QuitGameUseCase } from './services/quitGameUseCase'
import { ChipTopUpUseCase } from './services/chipTopUpUseCase'
import { MIN_BB, MAX_PLAYERS_COUNT } from '../../constants/game'
import { StartGameUseCase, TakeActionUseCase } from './services/flow'
import { respondFromApiResult } from '../../utils/respondFromApiResult'
import { ShowMyHandPokesUseCase } from './services/showMyHandPokesUseCase'
import { scheduleBuiltInVoiceBroadcast } from './services/builtInVoiceBroadcastScheduler'
import {
  gameRuntimeRegistry,
  getCurrentMatchIdWithFallback
} from './services/runtimeKit'
import {
  gameRuntimeConfig,
  type GameRuntimeConfigPatch
} from '../../utils/gameRuntimeConfig'
import {
  BUILT_IN_VOICE_NAME_SET,
  BUILT_IN_VOICE_USER_COOLDOWN_MS
} from '../../constants/builtInVoice'

const gameClientApi = combinePath(apiPrefixClient)('/game')
const startGameUseCase = new StartGameUseCase()
const takeActionUseCase = new TakeActionUseCase()
const chipTopUpUseCase = new ChipTopUpUseCase()
const gameWsGateway = new GameWsGateway()
const quitGameUseCase = new QuitGameUseCase(gameWsGateway)
const showMyHandPokesUseCase = new ShowMyHandPokesUseCase(gameWsGateway)

// 客户端：获取游戏基础配置, 使用get方法, 客户端缓存
router.get(gameClientApi('/config'), async (ctx) => {
  response.success(ctx, {
    ...gameRuntimeConfig.getClientRulesSnapshot(),
    maxPlayersCount: MAX_PLAYERS_COUNT,
    minBB: MIN_BB
  })
})

/**
 * 管理员：运行时调整规则与各类延时（毫秒），无需重启；GET /game/config 仅返回规则三项（实时）。
 * 各类延时不在 config 中下发，改后返回完整快照供核对。
 * body 至少含一个字段，毫秒项范围 0～120000。
 */
router.post(gameClientApi('/setRuntimeConfig'), async (ctx) => {
  const userId = ctx.state.user!.id
  if (!(await isAdminUser(userId))) {
    response.error(ctx, HTTP_STATUS.FORBIDDEN, '无权限')
    return
  }
  const body = ctx.request.body as GameRuntimeConfigPatch
  const result = gameRuntimeConfig.applyPatch(body)
  if (!result.ok) {
    response.error(ctx, HTTP_STATUS.BAD_REQUEST, result.message)
    return
  }
  response.success(ctx, result.data, '已更新')
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
    response.error(ctx, HTTP_STATUS.BAD_REQUEST, '参数异常：需要 roomId')
    return
  }

  const requested = await startGameUseCase.requestStart(roomId, ownerId)
  if (!requested.ok) {
    respondFromApiResult(ctx, requested)
    return
  }

  // HTTP 立即返回：后续开局流程在后台异步推进
  response.success(ctx, { roomId }, '进入游戏中')
  startGameUseCase.runStartFlowInBackground(requested.data)

  return
})

// 用户重连后获取当前对局的状态
router.post(gameClientApi('/fetchCurrentGameState'), async (ctx) => {
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
    response.error(ctx, HTTP_STATUS.NOT_FOUND, '对局不存在')
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

/**
 * 局间补码（幂等：本局间已补过则静默成功）
 * body: { roomId: number } — afterMatchId、补码数量均由服务端计算/读取
 */
router.post(gameClientApi('/chipTopUp'), async (ctx) => {
  const body = ctx.request.body as { roomId?: unknown }
  const roomId = Number(body?.roomId)
  const userId = ctx.state.user!.id

  const result = await chipTopUpUseCase.execute({
    userId,
    roomId
  })
  respondFromApiResult(ctx, result, { okMessage: '成功' })
})

/**
 * 退出对局：删 `RoomMember`、广播 `player-quit-game`、断开该用户 /game。
 * - `between_hands`：同步 `room.removeById`。
 * - Core 已为 `in_hand`：先 `FoldDueToLeave` 并 drain；环上摘座延至本手 `reset` 后（可立刻加入其它房间）。
 * - `starting_hand`：不可退出（与引擎尚未 `start` 一致）。
 */
router.post(gameClientApi('/quit'), async (ctx) => {
  const body = ctx.request.body as { roomId?: unknown }
  const roomId = Number(body?.roomId)
  const userId = ctx.state.user!.id

  if (!roomId || !Number.isInteger(roomId)) {
    response.error(ctx, HTTP_STATUS.BAD_REQUEST, '参数异常：需要 roomId')
    return
  }

  const result = await quitGameUseCase.execute({ userId, roomId })
  respondFromApiResult(ctx, result, { okMessage: '已退出对局' })
})

/**
 * 局间主动亮牌（每人每 match 幂等，仅首次向 /game 推送 `player-hand-voluntarily-shown`）
 * 本手已弃牌者，或独收池（恰好一名未弃牌）时在坐者，均可亮自己的底牌。
 * body: { roomId: number, matchId: number }
 */
router.post(gameClientApi('/showMyHandPokes'), async (ctx) => {
  const body = ctx.request.body as { roomId?: unknown; matchId?: unknown }
  const roomId = Number(body?.roomId)
  const matchId = Number(body?.matchId)
  const userId = ctx.state.user!.id

  if (
    !roomId ||
    !Number.isInteger(roomId) ||
    !matchId ||
    !Number.isInteger(matchId)
  ) {
    response.error(
      ctx,
      HTTP_STATUS.BAD_REQUEST,
      '参数异常：需要 roomId、matchId'
    )
    return
  }

  const result = await showMyHandPokesUseCase.execute({
    userId,
    roomId,
    matchId
  })
  respondFromApiResult(ctx, result, { okMessage: '成功' })
})

router.post(gameClientApi('/takeAction'), async (ctx) => {
  const {
    actionType,
    amount = 0
  }: { actionType?: ActionType; amount?: number } = ctx.request.body ?? {}
  const userId = ctx.state.user!.id

  const result = await takeActionUseCase.execute({
    userId,
    actionType: actionType as ActionType,
    amount: Number(amount)
  })
  respondFromApiResult(ctx, result, { okMessage: '行动已提交' })
})

const builtInVoiceUserLastAt = new Map<string, number>()

function builtInVoiceUserKey(roomId: number, userId: number): string {
  return `${roomId}:${userId}`
}

/**
 * 牌桌内置语音：校验房间、成员、白名单；每人每房 5s 内仅可请求一次；
 * 同一房间内 WS 广播排队，相邻两次实际发出至少间隔 3s。
 * body: { roomId: number, voiceName: string }
 */
router.post(gameClientApi('/send_built_in_voice'), async (ctx) => {
  const body = ctx.request.body as { roomId?: unknown; voiceName?: unknown }
  const roomId = Number(body?.roomId)
  const voiceNameRaw =
    typeof body?.voiceName === 'string' ? body.voiceName.trim() : ''
  const userId = ctx.state.user!.id

  if (!roomId || !Number.isInteger(roomId)) {
    response.error(ctx, HTTP_STATUS.BAD_REQUEST, '参数异常：需要 roomId')
    return
  }
  if (!voiceNameRaw) {
    response.error(ctx, HTTP_STATUS.BAD_REQUEST, '参数异常：需要 voiceName')
    return
  }
  if (!BUILT_IN_VOICE_NAME_SET.has(voiceNameRaw)) {
    response.error(ctx, HTTP_STATUS.BAD_REQUEST, '内置语音不存在')
    return
  }

  const roomRow = await room.findFirst({
    where: { id: roomId, deletedAt: null },
    select: { id: true }
  })
  if (!roomRow) {
    response.error(ctx, HTTP_STATUS.NOT_FOUND, '房间不存在')
    return
  }

  const membership = await roomMember.findFirst({
    where: { userId, roomId },
    select: { id: true }
  })
  if (!membership) {
    response.error(ctx, HTTP_STATUS.FORBIDDEN, '不在该房间中')
    return
  }

  const uKey = builtInVoiceUserKey(roomId, userId)
  const now = Date.now()
  const lastAt = builtInVoiceUserLastAt.get(uKey) ?? 0
  if (now - lastAt < BUILT_IN_VOICE_USER_COOLDOWN_MS) {
    response.error(
      ctx,
      HTTP_STATUS.TOO_MANY_REQUESTS,
      '发送语音太频繁, 需要间隔5秒'
    )
    return
  }
  builtInVoiceUserLastAt.set(uKey, now)

  response.success(ctx, true)
  scheduleBuiltInVoiceBroadcast(
    roomId,
    { userId, voiceName: voiceNameRaw },
    gameWsGateway
  )
})
