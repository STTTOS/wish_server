import type { Player } from 'texas-poker-core'
import type { ApiResult } from '../../../utils/apiResult'

import { Texas } from 'texas-poker-core'
import { Prisma } from '@prisma/texas-client'

import { logger } from '../../../logger'
import { GameWsGateway } from './gameWsGateway'
import { gameRuntimeRegistry } from './runtimeRegistry'
import { HTTP_STATUS } from '../../../constants/httpStatus'
import { room, match, roomMember, roomChipTopUp } from '../../../models'
import { CHIP_TOP_UP_ELIGIBLE_RATIO } from '../../../constants/chipTopUp'

export type ChipTopUpInput = {
  userId: number
  roomId: number
}

export type ChipTopUpData = {
  balanceAfter: number
  /** 本次实际补入数量（来自库 Room.initialChips） */
  topUpAmount: number
  /** 服务端推导：本房最近已结束的一手 matchId，作幂等与审计锚点 */
  afterMatchId: number
  /** 本次请求未改引擎（本局间已补过） */
  alreadyApplied?: boolean
}

type ChipTopUpContext = {
  userId: number
  roomId: number
  roomKey: string
  topUpAmount: number
  afterMatchId: number
  initialChips: number
  texas: Texas
  player: Player
}

type LoadContextResult =
  | { tag: 'ok'; ctx: ChipTopUpContext }
  | { tag: 'fail'; result: ApiResult<ChipTopUpData> }

function isEligibleStack(stack: number, initialChips: number): boolean {
  return stack * 100 <= initialChips * (CHIP_TOP_UP_ELIGIBLE_RATIO * 100)
}

function fail(
  status: number,
  message: string
): { tag: 'fail'; result: ApiResult<ChipTopUpData> } {
  return { tag: 'fail', result: { ok: false, status, message } }
}

type CommitTopUpDbParams = {
  userId: number
  roomId: number
  roomKey: string
  topUpAmount: number
  afterMatchId: number
  roomInitialChipsSnapshot: number
  balanceBefore: number
  balanceAfter: number
  player: Player
  wsGateway: GameWsGateway
}

type CommitTopUpDbResult =
  | {
      tag: 'success'
      data: { balanceAfter: number; topUpAmount: number; afterMatchId: number }
    }
  | {
      tag: 'duplicate'
      data: { balanceAfter: number; topUpAmount: number; afterMatchId: number }
    }
  | { tag: 'engine_error'; message: string }
  | { tag: 'db_error'; message: string }

async function commitTopUpEngineAndDb(
  params: CommitTopUpDbParams
): Promise<CommitTopUpDbResult> {
  const {
    userId,
    roomId,
    roomKey,
    topUpAmount,
    afterMatchId,
    roomInitialChipsSnapshot,
    balanceBefore,
    balanceAfter,
    player,
    wsGateway
  } = params

  try {
    player.balance = balanceAfter
  } catch (e) {
    const message = e instanceof Error ? e.message : '补码失败'
    return { tag: 'engine_error', message }
  }

  try {
    await roomChipTopUp.create({
      data: {
        roomId,
        userId,
        afterMatchId,
        amount: topUpAmount,
        balanceBefore,
        balanceAfter,
        roomInitialChipsSnapshot
      }
    })
  } catch (e) {
    player.balance = balanceBefore
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === 'P2002'
    ) {
      const winnerRow = await roomChipTopUp.findUnique({
        where: {
          roomId_userId_afterMatchId: {
            roomId,
            userId,
            afterMatchId
          }
        },
        select: { amount: true, afterMatchId: true }
      })
      return {
        tag: 'duplicate',
        data: {
          balanceAfter: Math.round(player.balance),
          topUpAmount: winnerRow?.amount ?? topUpAmount,
          afterMatchId: winnerRow?.afterMatchId ?? afterMatchId
        }
      }
    }
    const message = e instanceof Error ? e.message : '补码记录失败'
    return { tag: 'db_error', message }
  }

  const finalBalance = Math.round(player.balance)
  try {
    wsGateway.notifyPlayerChipTopUp(roomKey, {
      roomId,
      userId,
      afterMatchId,
      topUpAmount,
      balanceAfter: finalBalance
    })
  } catch (notifyErr) {
    logger.error('[chipTopUp] notify player-chip-top-up failed', notifyErr)
  }

  return {
    tag: 'success',
    data: {
      balanceAfter: finalBalance,
      topUpAmount,
      afterMatchId
    }
  }
}

export type AutoTopUpAtHandLockParams = {
  roomId: number
  roomKey: string
  texas: Texas
  lowestBetAmount: number
  initialChips: number
  wsGateway: GameWsGateway
  /** 本手 `Match.id`（须已落库且为 runtime `currentMatchId`） */
  handMatchId: number
}

export type ApplyTopUpPlansAtHandLockResult = {
  kickedUserIds: number[]
}

/**
 * 下一手 `lockAt`：在座（on-set）玩家若 `round(balance) <= lowestBetAmount`，
 * 自动补入 `initialChips` 并写 `RoomChipTopUp`。
 * `handMatchId` 须为 `onLock` 内**已创建并已 `setCurrentMatchId` 的本手 `Match.id`**，
 * 用作 `afterMatchId` 锚点，便于本手作废时 `deleteMany({ afterMatchId })`（与 HTTP 补码用「最近已结束手」区分）。
 */
export async function autoTopUpOnSeatPlayersAtHandLock(
  params: AutoTopUpAtHandLockParams
): Promise<void> {
  const {
    roomId,
    roomKey,
    texas,
    lowestBetAmount,
    initialChips,
    wsGateway,
    handMatchId
  } = params
  if (initialChips <= 0) return

  const afterMatchId = handMatchId
  const seated = texas.room.getPlayersBySeatStatus('on-set')

  for (const player of seated) {
    const userId = player.getUserInfo().id
    const balanceBefore = Math.round(player.balance)
    if (balanceBefore > lowestBetAmount) continue

    const existing = await roomChipTopUp.findUnique({
      where: {
        roomId_userId_afterMatchId: { roomId, userId, afterMatchId }
      }
    })
    if (existing) continue

    const balanceAfter = balanceBefore + initialChips
    const r = await commitTopUpEngineAndDb({
      userId,
      roomId,
      roomKey,
      topUpAmount: initialChips,
      afterMatchId,
      roomInitialChipsSnapshot: initialChips,
      balanceBefore,
      balanceAfter,
      player,
      wsGateway
    })
    if (r.tag === 'engine_error' || r.tag === 'db_error') {
      logger.error('[autoChipTopUp] commit failed', {
        roomId,
        userId,
        tag: r.tag,
        message: 'message' in r ? r.message : undefined
      })
    }
  }
}

/**
 * onLock 统一处理补码申请：
 * - auto enabled 且余额 < initialChips，则自动补到 initialChips
 * - 余额 <= 0：踢出房间并广播 quit（用于客户端退场）
 */
export async function applyTopUpPlansAtHandLock(
  params: AutoTopUpAtHandLockParams
): Promise<ApplyTopUpPlansAtHandLockResult> {
  const { roomId, roomKey, texas, initialChips, wsGateway, handMatchId } =
    params
  const afterMatchId = handMatchId
  const kickedUserIds: number[] = []
  const seated = texas.room.getPlayersBySeatStatus('on-set')

  for (const player of seated) {
    const userId = player.getUserInfo().id
    const balanceBefore = Math.round(player.balance)
    const autoEnabled = gameRuntimeRegistry.isAutoTopUpEnabled(roomKey, userId)
    const targetBalance =
      autoEnabled && balanceBefore < initialChips ? initialChips : null

    if (targetBalance != null && targetBalance > balanceBefore) {
      const topUpAmount = targetBalance - balanceBefore
      const existing = await roomChipTopUp.findUnique({
        where: {
          roomId_userId_afterMatchId: { roomId, userId, afterMatchId }
        }
      })
      if (!existing) {
        const r = await commitTopUpEngineAndDb({
          userId,
          roomId,
          roomKey,
          topUpAmount,
          afterMatchId,
          roomInitialChipsSnapshot: initialChips,
          balanceBefore,
          balanceAfter: targetBalance,
          player,
          wsGateway
        })
        if (r.tag === 'engine_error' || r.tag === 'db_error') {
          logger.error('[topUpPlan] commit failed', {
            roomId,
            userId,
            tag: r.tag,
            message: 'message' in r ? r.message : undefined
          })
        }
      }
      continue
    }

    if (balanceBefore <= 0) {
      try {
        await roomMember.deleteMany({ where: { roomId, userId } })
        if (texas.room.has(userId)) texas.room.removeById(userId)
        gameRuntimeRegistry.clearConnectionTracking(roomKey, userId)
        wsGateway.notifyPlayerQuitGame(roomKey, {
          roomId,
          userId,
          reason: 'zero_balance_no_topup'
        })
        wsGateway.disconnectUserRoomSockets(roomId, userId)
        kickedUserIds.push(userId)
      } catch (e) {
        logger.error('[topUpPlan] zero balance kick failed', {
          roomId,
          userId,
          error: e instanceof Error ? e.message : String(e)
        })
      }
    }
  }

  return { kickedUserIds }
}

/**
 * 局间补码：`afterMatchId` 由服务端取本房「最近已结束」的 Match（按 endedAt、id 降序）。
 * 幂等：同一 (roomId, userId, afterMatchId) 已存在记录时静默成功。
 *
 * 事务：引擎内存与 DB 无法同事务；采用「先改引擎余额，再写库；写库失败则回滚引擎」；
 * 唯一约束处理并发双写。
 *
 * 说明：从读取「最近已结束 match」到写库之间存在极短窗口，若此时恰好结束新一手，
 * 锚点仍可能指向「查询时刻」的最近一手；一般可接受。
 */
export class ChipTopUpUseCase {
  constructor(private readonly wsGateway = new GameWsGateway()) {}

  async execute(input: ChipTopUpInput): Promise<ApiResult<ChipTopUpData>> {
    const loaded = await this.#loadContext(input)
    if (loaded.tag === 'fail') return loaded.result

    const { ctx } = loaded
    const { userId, roomId, topUpAmount, afterMatchId, player } = ctx

    const existing = await roomChipTopUp.findUnique({
      where: {
        roomId_userId_afterMatchId: { roomId, userId, afterMatchId }
      }
    })
    if (existing) {
      return {
        ok: true,
        data: {
          balanceAfter: Math.round(player.balance),
          topUpAmount: existing.amount,
          afterMatchId: existing.afterMatchId,
          alreadyApplied: true
        }
      }
    }

    const balanceBefore = Math.round(player.balance)
    if (!isEligibleStack(balanceBefore, ctx.initialChips)) {
      return {
        ok: false,
        status: HTTP_STATUS.CONFLICT,
        message: '当前筹码未达到补码条件'
      }
    }

    const balanceAfter = balanceBefore + topUpAmount
    return this.#commitTopUp(ctx, balanceBefore, balanceAfter)
  }

  /** 成员身份、房间局间、最近已结束 match、运行时 idle、玩家在座 */
  async #loadContext(input: ChipTopUpInput): Promise<LoadContextResult> {
    const { userId, roomId } = input

    if (!Number.isInteger(roomId)) {
      return fail(HTTP_STATUS.BAD_REQUEST, '参数异常：需要合法 roomId')
    }

    const membership = await roomMember.findFirst({
      where: { userId, roomId, room: { deletedAt: null } },
      select: { roomId: true }
    })
    if (!membership) {
      return fail(HTTP_STATUS.FORBIDDEN, '不在该房间或未入座')
    }

    const roomRow = await room.findFirst({
      where: { id: roomId, deletedAt: null },
      select: { id: true, initialChips: true, gameStatus: true }
    })
    if (!roomRow) {
      return fail(HTTP_STATUS.NOT_FOUND, '房间不存在')
    }
    if (roomRow.gameStatus !== 'between_hands') {
      return fail(HTTP_STATUS.CONFLICT, '仅局间可补码')
    }

    const topUpAmount = roomRow.initialChips
    if (topUpAmount <= 0) {
      return fail(HTTP_STATUS.CONFLICT, '房间未配置起始筹码')
    }

    const lastEndedMatch = await match.findFirst({
      where: { roomId, endedAt: { not: null } },
      orderBy: [{ endedAt: 'desc' }, { id: 'desc' }],
      select: { id: true }
    })
    if (!lastEndedMatch) {
      return fail(HTTP_STATUS.BAD_REQUEST, '暂无已结束的对局，无法补码')
    }
    const afterMatchId = lastEndedMatch.id

    const roomKey = String(roomId)
    const texas = gameRuntimeRegistry.getTexas(roomKey)
    if (!texas) {
      return fail(HTTP_STATUS.NOT_FOUND, '对局运行时不可用')
    }
    if ((texas.controller.status as unknown as string) !== 'idle') {
      return fail(HTTP_STATUS.CONFLICT, '仅局间可补码')
    }

    const player = texas.dealer.find((p) => p.getUserInfo().id === userId)
    if (!player) {
      return fail(HTTP_STATUS.FORBIDDEN, '你不在该对局座位上')
    }

    return {
      tag: 'ok',
      ctx: {
        userId,
        roomId,
        roomKey,
        topUpAmount,
        afterMatchId,
        initialChips: roomRow.initialChips,
        texas,
        player
      }
    }
  }

  /** 引擎加钱 → 写 RoomChipTopUp → WS；失败回滚引擎 */
  async #commitTopUp(
    ctx: ChipTopUpContext,
    balanceBefore: number,
    balanceAfter: number
  ): Promise<ApiResult<ChipTopUpData>> {
    const { userId, roomId, roomKey, topUpAmount, afterMatchId, player } = ctx

    const r = await commitTopUpEngineAndDb({
      userId,
      roomId,
      roomKey,
      topUpAmount,
      afterMatchId,
      roomInitialChipsSnapshot: ctx.initialChips,
      balanceBefore,
      balanceAfter,
      player,
      wsGateway: this.wsGateway
    })

    if (r.tag === 'engine_error') {
      return { ok: false, status: HTTP_STATUS.CONFLICT, message: r.message }
    }
    if (r.tag === 'db_error') {
      return {
        ok: false,
        status: HTTP_STATUS.INTERNAL_SERVER_ERROR,
        message: r.message
      }
    }
    if (r.tag === 'duplicate') {
      return {
        ok: true,
        data: {
          ...r.data,
          alreadyApplied: true
        }
      }
    }
    return { ok: true, data: r.data }
  }
}
