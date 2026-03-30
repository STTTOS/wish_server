import type { RoomWsMessage } from './ws-event-types'

import dayjs from 'dayjs'
import { isNil } from 'ramda'
import { Prisma } from '@prisma/texas-client'

import router from '../instance'
import { ws } from '../../server'
import response from '../../utils/response'
import combinePath from '../../utils/combinePath'
import { room, user, roomMember } from '../../models'
import { generateRoomCode } from '../../utils/roomCode'
import { timeFormat, apiPrefixClient } from '../../config'
import {
  MIN_BB,
  MIN_THINKING_TIME,
  INITIAL_CHIPS_MIN_BB_MULTIPLIER
} from '../../constants/game'
import {
  RoomJoinFacade,
  RoomQuitFacade,
  RoomKickFacade,
  RoomMembersFacade,
  WaitingRoomGateway
} from './services/flow'

const roomApiClient = combinePath(apiPrefixClient)('/room')

const roomMembersFacade = new RoomMembersFacade(new WaitingRoomGateway(ws))
const roomJoinFacade = new RoomJoinFacade(new WaitingRoomGateway(ws))
const roomQuitFacade = new RoomQuitFacade(new WaitingRoomGateway(ws))
const roomKickFacade = new RoomKickFacade(new WaitingRoomGateway(ws))

/**
 * 客户端创建房间
 */
router.post(roomApiClient('/create'), async (ctx) => {
  const {
    lowestBetAmount,
    thinkingTime,
    isPrivate,
    initialChips
  }: Prisma.RoomCreateInput = ctx.request.body
  const userId = ctx.state.user!.id
  if ([lowestBetAmount, thinkingTime, isPrivate, initialChips].some(isNil)) {
    response.error(ctx, 400, '参数异常')
    return
  }

  const userInfo = await user.findUnique({
    where: {
      id: userId
    }
  })
  if (!userInfo) {
    response.error(ctx, 2100, '玩家不存在, 无法创建房间')
    return
  }

  if (thinkingTime < MIN_THINKING_TIME) {
    response.error(ctx, 2100, `思考时间不可小于${MIN_THINKING_TIME}s`)
    return
  }

  if (!Number.isInteger(lowestBetAmount) || lowestBetAmount < MIN_BB) {
    response.error(ctx, 2100, '盲注金额异常')
    return
  }

  if (
    !Number.isInteger(initialChips) ||
    initialChips! < lowestBetAmount * INITIAL_CHIPS_MIN_BB_MULTIPLIER
  ) {
    response.error(
      ctx,
      2100,
      `初始筹码必须为整数且大于等于大盲注的${INITIAL_CHIPS_MIN_BB_MULTIPLIER}倍`
    )
    return
  }

  // 如果用户已经在其他房间中，则不可再创建房间
  const joinedRoom = await roomMember.findFirst({
    where: {
      userId,
      room: {
        deletedAt: null
      }
    }
  })
  if (joinedRoom) {
    response.error(ctx, 2100, '你已在房间中, 请先退出后再创建房间')
    return
  }

  const roomExisted = await room.findFirst({
    where: {
      ownerId: userId,
      deletedAt: null
    }
  })
  if (roomExisted) {
    response.error(ctx, 2100, '不可重复创建房间')
    return
  }

  const roomCode = generateRoomCode()
  const res = await room.create({
    data: {
      code: roomCode,
      isPrivate,
      thinkingTime,
      lowestBetAmount,
      initialChips,
      ownerId: userInfo.id
    }
  })
  await roomMember.create({
    data: { roomId: res.id, userId: userInfo.id }
  })

  ws.broadcastRoomList({
    type: 'room-list-room-created',
    data: {
      id: res.id,
      code: res.code,
      owner: {
        id: userInfo.id,
        name: userInfo.name,
        avatarUrl: userInfo.avatarUrl,
        avatarKey: userInfo.avatarKey
      },
      initialChips: res.initialChips,
      thinkingTime: res.thinkingTime,
      lowestBetAmount: res.lowestBetAmount,
      createdAt: dayjs(res.createdAt).format(timeFormat),
      memberCount: 1
    }
  } satisfies RoomWsMessage<'room-list-room-created'>)

  response.success(ctx, { roomId: res.id, roomCode }, '房间创建成功')
})

// 客户端获取房间列表
router.post(roomApiClient('/list'), async (ctx) => {
  const rooms = await room.findMany({
    where: {
      isPrivate: false,
      deletedAt: null
    },
    include: {
      owner: {
        select: {
          id: true,
          name: true,
          avatarUrl: true,
          avatarKey: true
        }
      },
      members: {
        select: {
          id: true
        }
      }
    }
  })
  const result = rooms.map(
    ({
      id,
      code,
      lowestBetAmount,
      thinkingTime,
      createdAt,
      owner,
      initialChips,
      members
    }) => {
      return {
        id,
        code,
        owner,
        initialChips,
        thinkingTime,
        lowestBetAmount,
        createdAt: dayjs(createdAt).format(timeFormat),
        memberCount: members.length
      }
    }
  )
  response.success(ctx, result)
})

// 客户端：通过房间代码加入房间
router.post(roomApiClient('/join'), async (ctx) => {
  const { roomCode } = ctx.request.body as { roomCode?: unknown }
  const userId = ctx.state.user!.id

  const normalizedRoomCode = typeof roomCode === 'string' ? roomCode : ''

  const result = await roomJoinFacade.execute({
    roomCode: normalizedRoomCode,
    userId
  })

  if (!result.ok) {
    response.error(ctx, result.code, result.message)
    return
  }

  response.success(ctx, null, '加入成功')
})

// 客户端：退出房间（幂等：房间已删、或已不在成员表中、或重复调用均返回成功）
router.post(roomApiClient('/quit'), async (ctx) => {
  const { roomCode } = ctx.request.body as { roomCode?: unknown }
  const userId = ctx.state.user!.id

  const result = await roomQuitFacade.execute({ roomCode, userId })
  if (!result.ok) {
    response.error(ctx, result.code, result.message)
    return
  }

  response.success(ctx, null, '已退出房间')
})

// 客户端：房主踢人
router.post(roomApiClient('/kick'), async (ctx) => {
  const { roomCode, targetUserId } = ctx.request.body as {
    roomCode?: unknown
    targetUserId?: unknown
  }
  const operatorId = ctx.state.user!.id

  const result = await roomKickFacade.execute({
    roomCode,
    targetUserId,
    operatorId
  })

  if (!result.ok) {
    response.error(ctx, result.code, result.message)
    return
  }

  response.success(ctx, null, '已踢出该玩家')
})

// 客户端：查询房间详情（思考时间、是否公开、大盲注）
router.post(roomApiClient('/detail'), async (ctx) => {
  const { roomCode }: { roomCode?: string } = ctx.request.body

  if (!roomCode || !roomCode.trim()) {
    response.error(ctx, 400, '参数异常：需要 roomCode')
    return
  }

  const roomInfo = await room.findUnique({
    where: {
      code: roomCode.trim().toUpperCase()
    },
    include: {
      owner: {
        select: {
          id: true,
          name: true,
          avatarUrl: true,
          avatarKey: true
        }
      }
    }
  })
  if (!roomInfo || roomInfo.deletedAt) {
    response.error(ctx, 2000, '房间不存在')
    return
  }
  const {
    id,
    code,
    isPrivate,
    thinkingTime,
    lowestBetAmount,
    owner,
    gameStatus,
    initialChips
  } = roomInfo

  response.success(ctx, {
    id,
    code,
    owner,
    gameStatus,
    isPrivate,
    thinkingTime,
    initialChips,
    lowestBetAmount
  })
})

/**
 * 客户端：查询房间成员列表（含 `isOnline` / `isWaitingRoomOnline`）。
 * Body: `roomCode`（必填）。房间摘要请用 `.../room/detail`。
 */
router.post(roomApiClient('/members'), async (ctx) => {
  const { roomCode } = ctx.request.body as { roomCode?: string }
  const userId = ctx.state.user!.id

  const result = await roomMembersFacade.execute({
    roomCode: roomCode ?? '',
    userId
  })
  if (!result.ok) {
    response.error(ctx, result.code, result.message)
    return
  }
  response.success(ctx, result.data.members)
})
