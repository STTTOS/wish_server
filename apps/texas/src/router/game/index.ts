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
import { gameRuntimeRegistry } from './services/runtimeKit'
import { QuitGameUseCase } from './services/quitGameUseCase'
import { ChipTopUpUseCase } from './services/chipTopUpUseCase'
import { SubmitTopUpPlanUseCase } from './services/topUpPlanUseCase'
import { respondFromApiResult } from '../../utils/respondFromApiResult'
import { ShowMyHandPokesUseCase } from './services/showMyHandPokesUseCase'
import { buildFetchCurrentGameStatePayload } from './services/currentGameStateSnapshot'
import { scheduleBuiltInVoiceBroadcast } from './services/builtInVoiceBroadcastScheduler'
import {
  JoinGameUseCase,
  StartGameUseCase,
  TakeActionUseCase
} from './services/flow'
import {
  gameRuntimeConfig,
  type GameRuntimeConfigPatch
} from '../../utils/gameRuntimeConfig'
import {
  BUILT_IN_VOICE_NAME_SET,
  BUILT_IN_VOICE_USER_COOLDOWN_MS
} from '../../constants/builtInVoice'
import {
  MAX_PLAYERS_COUNT,
  ROOM_PRESET_RULES,
  CUSTOM_27O_REWARD_TIERS,
  ROOM_LOWEST_BET_OPTIONS,
  ROOM_THINKING_TIME_OPTIONS,
  ROOM_CUSTOM_INITIAL_CHIPS_BB_MULTIPLIER_MAX,
  ROOM_CUSTOM_INITIAL_CHIPS_BB_MULTIPLIER_MIN
} from '../../constants/game'

const gameClientApi = combinePath(apiPrefixClient)('/game')
const startGameUseCase = new StartGameUseCase()
const takeActionUseCase = new TakeActionUseCase()
const chipTopUpUseCase = new ChipTopUpUseCase()
const submitTopUpPlanUseCase = new SubmitTopUpPlanUseCase()
const gameWsGateway = new GameWsGateway()
const quitGameUseCase = new QuitGameUseCase(gameWsGateway)
const joinGameUseCase = new JoinGameUseCase()
const showMyHandPokesUseCase = new ShowMyHandPokesUseCase(gameWsGateway)

// 客户端：获取游戏基础配置, 使用get方法, 客户端缓存
router.get(gameClientApi('/config'), async (ctx) => {
  response.success(ctx, {
    maxPlayersCount: MAX_PLAYERS_COUNT,
    roomLowestBetOptions: ROOM_LOWEST_BET_OPTIONS,
    roomThinkingTimeOptions: ROOM_THINKING_TIME_OPTIONS,
    customInitialChipsBbMultiplierMin:
      ROOM_CUSTOM_INITIAL_CHIPS_BB_MULTIPLIER_MIN,
    customInitialChipsBbMultiplierMax:
      ROOM_CUSTOM_INITIAL_CHIPS_BB_MULTIPLIER_MAX,
    roomPresetRules: ROOM_PRESET_RULES,
    custom27oRewardTiers: CUSTOM_27O_REWARD_TIERS
  })
})

/**
 * 管理员：运行时调整各类延时（毫秒），无需重启。
 * `GET /game/config` 返回的是静态规则配置；改后返回完整快照供核对。
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
 * 客户端：waiting-room 房主点击开始游戏（进入对局）
 * url: client/game/entring
 * body: { roomId: number }
 */
router.post(gameClientApi('/entring'), async (ctx) => {
  const { roomId }: { roomId?: number } = ctx.request.body ?? {}
  const lobbyOwnerId = ctx.state.user!.id
  if (!roomId || !Number.isInteger(roomId)) {
    response.error(ctx, HTTP_STATUS.BAD_REQUEST, '参数异常：需要 roomId')
    return
  }

  const requested = await startGameUseCase.requestStart(roomId, lobbyOwnerId)
  if (!requested.ok) {
    respondFromApiResult(ctx, requested)
    return
  }

  // HTTP 立即返回：后续开局流程在后台异步推进
  response.success(ctx, { roomId }, '进入游戏中')
  startGameUseCase.runStartFlowInBackground(requested.data)

  return
})

/**
 * 用户重连后拉取牌桌快照（与全房 WS 对齐：`player-roles-assigned` / `player-action-required` /
 * `player-action-taken` / `game-stage-changed` / `game-end` / `next-hand-countdown-*` 等）。
 * 不再仅在 `in_hand` 返回：局间 `idle` / `between_hands` 等一并下发，便于客户端对齐 UI。
 */
router.post(gameClientApi('/fetchCurrentGameState'), async (ctx) => {
  const userId = ctx.state.user!.id
  const membership = await roomMember.findFirst({
    where: { userId, room: { deletedAt: null } },
    select: {
      roomId: true,
      room: { select: { gameStatus: true } }
    }
  })
  const roomId = membership?.roomId
  const texas = roomId
    ? gameRuntimeRegistry.getTexas(String(roomId))
    : undefined
  if (!roomId || !texas || !membership) {
    response.error(ctx, HTTP_STATUS.NOT_FOUND, '对局不存在')
    return
  }

  const payload = await buildFetchCurrentGameStatePayload({
    texas,
    roomId,
    userId,
    roomGameStatus: membership.room.gameStatus
  })
  response.success(ctx, payload)
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
 * 提交/修改补码申请（onLock 统一处理）与自动补码开关。
 * body: { roomId: number, targetBalance?: number | null, autoTopUpEnabled?: boolean }
 */
router.post(gameClientApi('/topUpPlan'), async (ctx) => {
  const body = ctx.request.body as {
    roomId?: unknown
    targetBalance?: unknown
    autoTopUpEnabled?: unknown
  }
  const roomId = Number(body?.roomId)
  const userId = ctx.state.user!.id
  const targetBalanceRaw = body?.targetBalance
  let targetBalance: number | null | undefined
  if (targetBalanceRaw === undefined) {
    targetBalance = undefined
  } else if (targetBalanceRaw == null) {
    targetBalance = null
  } else {
    targetBalance = Number(targetBalanceRaw ?? Number.NaN)
  }
  const autoTopUpEnabled =
    typeof body?.autoTopUpEnabled === 'boolean'
      ? body.autoTopUpEnabled
      : undefined

  if (!roomId || !Number.isInteger(roomId)) {
    response.error(ctx, HTTP_STATUS.BAD_REQUEST, '参数异常：需要 roomId')
    return
  }
  if (
    targetBalanceRaw !== undefined &&
    targetBalanceRaw != null &&
    !Number.isFinite(targetBalance)
  ) {
    response.error(ctx, HTTP_STATUS.BAD_REQUEST, '参数异常：targetBalance 非法')
    return
  }

  const result = await submitTopUpPlanUseCase.execute({
    userId,
    roomId,
    targetBalance,
    autoTopUpEnabled
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
 * **非 waiting** 时加入对局：必要时写入 `RoomMember`，再同步 Core（`join`/`seat`）。
 * `waiting` 阶段请使用 `POST /room/join`（`roomCode`）。
 * body: { roomId: number }
 */
router.post(gameClientApi('/join'), async (ctx) => {
  const body = ctx.request.body as { roomId?: unknown }
  const roomId = Number(body?.roomId)
  const userId = ctx.state.user!.id

  if (!roomId || !Number.isInteger(roomId)) {
    response.error(ctx, HTTP_STATUS.BAD_REQUEST, '参数异常：需要 roomId')
    return
  }

  const result = await joinGameUseCase.execute({ userId, roomId })
  respondFromApiResult(ctx, result, { okMessage: '已加入对局' })
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
 * 牌桌内置语音：校验房间、成员、在坐（on-set）、白名单；每人每房 5s 内仅可请求一次；
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

  const texas = gameRuntimeRegistry.getTexas(String(roomId))
  if (!texas) {
    response.error(ctx, HTTP_STATUS.NOT_FOUND, '对局不存在')
    return
  }
  if (texas.room.getPlayerSeatStatusById(userId) !== 'on-set') {
    response.error(ctx, HTTP_STATUS.FORBIDDEN, '仅在座玩家可发送内置语音')
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
