import type { Context } from 'koa'
import type { RoomWsMessage } from './ws-event-types'

import dayjs from 'dayjs'
import { isNil } from 'ramda'
import { Prisma } from '@prisma/texas-client'

import router from '../instance'
import { ws } from '../../server'
import response from '../../utils/response'
import combinePath from '../../utils/combinePath'
import { generateRoomCode } from '../../utils/roomCode'
import { ERROR_CODE } from '../../constants/errorCodes'
import { timeFormat, apiPrefixClient } from '../../config'
import prisma, { room, user, roomMember } from '../../models'
import {
  MIN_BB,
  MAX_PLAYERS_COUNT,
  MIN_THINKING_TIME,
  INITIAL_CHIPS_MIN_BB_MULTIPLIER
} from '../../constants/game'

const roomApiClient = combinePath(apiPrefixClient)('/room')

type RoomMemberClientRow = {
  userId: number
  name: string
  avatarUrl: string | null
  avatarKey: string
  joinedAt: string
  isOwner: boolean
  /** 是否在等待房或游戏房任一 WS 通道在线（加入房间、展示谁在场时以此为准） */
  isOnline: boolean
  /** 是否仅在 `/waiting-room` 在线（对局内用户多为 false，需结合 `isOnline`） */
  isWaitingRoomOnline: boolean
}

async function buildRoomMembersClientList(
  roomId: number,
  ownerId: number
): Promise<RoomMemberClientRow[]> {
  const members = await roomMember.findMany({
    where: { roomId },
    include: { user: true },
    orderBy: { joinedAt: 'asc' }
  })
  const waitingRoomOnline = ws.getWaitingRoomOnlineUserIds(roomId)
  const gameRoomOnline = new Set(ws.getConnectedGameRoomUserIds(String(roomId)))
  return members.map(({ joinedAt, user: u }) => {
    const onWaiting = waitingRoomOnline.has(u.id)
    const onGame = gameRoomOnline.has(u.id)
    return {
      userId: u.id,
      name: u.name,
      avatarUrl: u.avatarUrl,
      avatarKey: u.avatarKey,
      joinedAt: dayjs(joinedAt).format(timeFormat),
      isOwner: ownerId === u.id,
      isOnline: onWaiting || onGame,
      isWaitingRoomOnline: onWaiting
    }
  })
}

function buildRoomSummaryForClient(roomInfo: {
  id: number
  code: string
  gameStatus: string
  isPrivate: boolean
  thinkingTime: number
  initialChips: number
  lowestBetAmount: number
  owner: {
    id: number
    name: string
    avatarUrl: string | null
    avatarKey: string
  }
}) {
  return {
    id: roomInfo.id,
    code: roomInfo.code,
    gameStatus: roomInfo.gameStatus,
    owner: roomInfo.owner,
    isPrivate: roomInfo.isPrivate,
    thinkingTime: roomInfo.thinkingTime,
    initialChips: roomInfo.initialChips,
    lowestBetAmount: roomInfo.lowestBetAmount
  }
}

/**
 * 成员列表（含 WS 在线态）+ 可选附带房间摘要。
 */
async function handleRoomMembersRequest(
  ctx: Context,
  input: {
    roomCode: string | undefined
    userId: number
    includeRoom: boolean
    notInRoomMessage: string
  }
) {
  const { roomCode, userId, includeRoom, notInRoomMessage } = input

  if (!roomCode || !roomCode.trim()) {
    response.error(ctx, ERROR_CODE.BAD_REQUEST, '参数异常：需要 roomCode')
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
    response.error(ctx, ERROR_CODE.COMMON_FAIL, '房间不存在')
    return
  }

  const roomId = roomInfo.id

  const selfMember = await roomMember.findUnique({
    where: {
      // eslint-disable-next-line camelcase
      roomId_userId: {
        roomId,
        userId
      }
    }
  })
  if (!selfMember) {
    response.error(ctx, ERROR_CODE.FORBIDDEN, notInRoomMessage)
    return
  }

  const members = await buildRoomMembersClientList(roomId, roomInfo.ownerId)

  if (includeRoom) {
    response.success(ctx, {
      room: buildRoomSummaryForClient(roomInfo),
      members
    })
  } else {
    response.success(ctx, members)
  }
}

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
  const { roomCode: code }: { roomCode?: string } = ctx.request.body
  const userId = ctx.state.user!.id
  if (!code || typeof code !== 'string' || !code.trim()) {
    response.error(ctx, 400, '房间代码不能为空')
    return
  }

  const roomInfo = await room.findUnique({
    where: { code: code.trim().toUpperCase() },
    include: {
      owner: true,
      members: true
    }
  })
  if (!roomInfo || roomInfo.deletedAt) {
    response.error(ctx, 2000, '房间不存在或房间代码错误')
    return
  }
  if (roomInfo.gameStatus !== 'waiting') {
    response.error(ctx, 2100, '仅等待房间状态支持加入房间')
    return
  }

  const alreadyIn = roomInfo.members.some((m) => m.userId === userId)
  if (alreadyIn) {
    response.error(ctx, 2000, '你已经在该房间中')
    return
  }

  if (roomInfo.members.length >= MAX_PLAYERS_COUNT) {
    response.error(ctx, 2000, '房间已满')
    return
  }

  const inOtherRoom = await roomMember.findFirst({
    where: {
      userId,
      room: { id: { not: roomInfo.id }, deletedAt: null }
    }
  })
  if (inOtherRoom) {
    response.error(ctx, 2000, '你已在其他房间中，请先退出后再加入')
    return
  }

  const joinUser = await user.findUnique({ where: { id: userId } })
  if (!joinUser) {
    response.error(ctx, 2000, '用户不存在')
    return
  }

  let memberCountAfterJoin = 0
  try {
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM \`Room\` WHERE id = ${roomInfo.id} FOR UPDATE`

      const latestRoom = await tx.room.findUnique({
        where: { id: roomInfo.id },
        select: { id: true, deletedAt: true, gameStatus: true }
      })
      if (!latestRoom || latestRoom.deletedAt) {
        throw new Error('房间不存在或房间代码错误')
      }
      if (latestRoom.gameStatus !== 'waiting') {
        throw new Error('仅等待房间状态支持加入房间')
      }

      const memberCount = await tx.roomMember.count({
        where: { roomId: roomInfo.id }
      })
      if (memberCount >= MAX_PLAYERS_COUNT) {
        throw new Error('房间已满')
      }

      const alreadyInRoom = await tx.roomMember.findUnique({
        where: { roomId_userId: { roomId: roomInfo.id, userId } } // eslint-disable-line camelcase
      })
      if (alreadyInRoom) throw new Error('你已经在该房间中')

      const inOtherRoomLatest = await tx.roomMember.findFirst({
        where: {
          userId,
          room: { id: { not: roomInfo.id }, deletedAt: null }
        }
      })
      if (inOtherRoomLatest) {
        throw new Error('你已在其他房间中，请先退出后再加入')
      }

      await tx.roomMember.create({
        data: { roomId: roomInfo.id, userId }
      })
      memberCountAfterJoin = memberCount + 1
    })
  } catch (e) {
    response.error(
      ctx,
      2000,
      e instanceof Error ? e.message : '加入房间失败，请稍后重试'
    )
    return
  }

  const memberPayload = {
    userId: joinUser.id,
    name: joinUser.name,
    avatarUrl: joinUser.avatarUrl,
    avatarKey: joinUser.avatarKey,
    joinedAt: dayjs().format(timeFormat),
    isOwner: roomInfo.ownerId === joinUser.id
  }
  ws.broadcastWaitingRoom(roomInfo.id, {
    type: 'waiting-room-member-joined',
    data: memberPayload
  } satisfies RoomWsMessage<'waiting-room-member-joined'>)

  // 更新房间列表中的实时人数
  ws.broadcastRoomList({
    type: 'room-list-member-count-changed',
    data: {
      roomId: roomInfo.id,
      memberCount: memberCountAfterJoin
    }
  } satisfies RoomWsMessage<'room-list-member-count-changed'>)

  response.success(ctx, null, '加入成功')
})

// 客户端：退出房间（幂等：房间已删、或已不在成员表中、或重复调用均返回成功）
router.post(roomApiClient('/quit'), async (ctx) => {
  const { roomCode }: { roomCode?: string } = ctx.request.body
  const userId = ctx.state.user!.id
  if (!roomCode || !roomCode.trim()) {
    response.error(ctx, 400, '参数异常：需要 roomCode')
    return
  }

  const code = roomCode.trim().toUpperCase()
  const roomInfo = await room.findUnique({
    where: { code }
  })
  if (!roomInfo) {
    response.error(ctx, 2000, '房间不存在')
    return
  }

  const roomId = roomInfo.id

  if (roomInfo.deletedAt) {
    ws.removeUserFromWaitingRoom(roomId, userId)
    response.success(ctx, null, '已退出房间')
    return
  }

  if (roomInfo.gameStatus !== 'waiting') {
    response.error(ctx, 2000, '仅等待房间状态支持退出房间')
    return
  }

  const compoundKey = { roomId, userId }
  let restCount = 0
  let deletedRoom = false
  let newOwnerId: number | null = null
  let quitNoop = false

  try {
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM \`Room\` WHERE id = ${roomId} FOR UPDATE`

      const latestRoom = await tx.room.findUnique({
        where: { id: roomId },
        select: { ownerId: true, gameStatus: true, deletedAt: true }
      })
      if (!latestRoom || latestRoom.deletedAt) {
        quitNoop = true
        return
      }
      if (latestRoom.gameStatus !== 'waiting') {
        throw new Error('仅等待房间状态支持退出房间')
      }

      const member = await tx.roomMember.findUnique({
        where: { roomId_userId: compoundKey } // eslint-disable-line camelcase
      })
      if (!member) {
        quitNoop = true
        return
      }

      const memberCount = await tx.roomMember.count({ where: { roomId } })
      if (latestRoom.ownerId === userId && memberCount > 1) {
        const nextOwnerMember = await tx.roomMember.findFirst({
          where: {
            roomId,
            userId: { not: userId }
          },
          orderBy: { joinedAt: 'asc' }
        })
        if (nextOwnerMember) {
          await tx.room.update({
            where: { id: roomId },
            data: { ownerId: nextOwnerMember.userId }
          })
          newOwnerId = nextOwnerMember.userId
        }
      }

      await tx.roomMember.delete({
        where: { roomId_userId: compoundKey } // eslint-disable-line camelcase
      })
      restCount = memberCount - 1
      if (restCount === 0) {
        await tx.room.update({
          where: { id: roomId },
          data: { deletedAt: new Date() }
        })
        deletedRoom = true
      }
    })
  } catch (e) {
    response.error(ctx, 2000, e instanceof Error ? e.message : '退出房间失败')
    return
  }

  // 取消该用户对 waiting-room 的订阅；幂等路径与正常退出都需要
  ws.removeUserFromWaitingRoom(roomId, userId)

  if (quitNoop) {
    response.success(ctx, null, '已退出房间')
    return
  }

  if (newOwnerId != null) {
    ws.broadcastWaitingRoom(roomId, {
      type: 'waiting-room-owner-changed',
      data: {
        oldOwnerId: userId,
        newOwnerId
      }
    } satisfies RoomWsMessage<'waiting-room-owner-changed'>)
  }

  ws.broadcastWaitingRoom(roomId, {
    type: 'waiting-room-member-left',
    data: { userId }
  } satisfies RoomWsMessage<'waiting-room-member-left'>)
  if (deletedRoom) {
    ws.broadcastRoomList({
      type: 'room-list-room-deleted',
      data: { roomId }
    } satisfies RoomWsMessage<'room-list-room-deleted'>)
  } else {
    // 非最后一人退出时，更新房间列表中的实时人数
    ws.broadcastRoomList({
      type: 'room-list-member-count-changed',
      data: {
        roomId,
        memberCount: restCount
      }
    } satisfies RoomWsMessage<'room-list-member-count-changed'>)
  }

  response.success(ctx, null, '已退出房间')
})

// 客户端：房主踢人
router.post(roomApiClient('/kick'), async (ctx) => {
  const {
    roomCode,
    targetUserId
  }: {
    roomCode?: string
    targetUserId?: number
  } = ctx.request.body
  const operatorId = ctx.state.user!.id
  if (!roomCode || !roomCode.trim() || targetUserId == null) {
    response.error(ctx, 400, '参数异常：需要 roomCode 和 targetUserId')
    return
  }

  const roomInfo = await room.findUnique({
    where: {
      code: roomCode.trim().toUpperCase()
    }
  })
  if (!roomInfo || roomInfo.deletedAt) {
    response.error(ctx, 2000, '房间不存在')
    return
  }
  if (roomInfo.gameStatus !== 'waiting') {
    response.error(ctx, 2100, '仅等待房间状态支持踢人')
    return
  }
  const roomId = roomInfo.id
  if (roomInfo.ownerId !== operatorId) {
    response.error(ctx, 403, '仅房主可以踢人')
    return
  }
  if (roomInfo.ownerId === targetUserId) {
    response.error(ctx, 400, '不能踢出房主')
    return
  }

  const compoundKey = { roomId, userId: targetUserId }
  let memberCountAfterKick = 0
  try {
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM \`Room\` WHERE id = ${roomId} FOR UPDATE`
      const latestRoom = await tx.room.findUnique({
        where: { id: roomId },
        select: { ownerId: true, gameStatus: true, deletedAt: true }
      })
      if (!latestRoom || latestRoom.deletedAt) throw new Error('房间不存在')
      if (latestRoom.ownerId !== operatorId) throw new Error('仅房主可以踢人')
      if (latestRoom.gameStatus !== 'waiting') {
        throw new Error('仅等待房间状态支持踢人')
      }

      const targetMember = await tx.roomMember.findUnique({
        where: { roomId_userId: compoundKey } // eslint-disable-line camelcase
      })
      if (!targetMember) throw new Error('该用户不在房间中')

      await tx.roomMember.delete({
        where: { roomId_userId: compoundKey } // eslint-disable-line camelcase
      })
      memberCountAfterKick = await tx.roomMember.count({ where: { roomId } })
    })
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : '踢人失败'
    const errorCode = errorMessage === '仅房主可以踢人' ? 403 : 2000
    response.error(ctx, errorCode, errorMessage)
    return
  }

  ws.broadcastWaitingRoom(roomId, {
    type: 'waiting-room-member-left',
    data: { userId: targetUserId }
  } satisfies RoomWsMessage<'waiting-room-member-left'>)
  // 先广播离开事件给客户端，再移除其 waiting-room 订阅
  ws.removeUserFromWaitingRoom(roomId, targetUserId)
  ws.broadcastRoomList({
    type: 'room-list-member-count-changed',
    data: {
      roomId,
      memberCount: memberCountAfterKick
    }
  } satisfies RoomWsMessage<'room-list-member-count-changed'>)

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
 * 客户端：查询房间成员列表（含 `isOnline`：等待房或游戏房 WS 任一连线即 true）。
 *
 * Body:
 * - `roomCode`（必填）
 * - `includeRoom`（可选）`true` 时 `data` 为 `{ room, members }`，否则 `data` 仅为成员数组
 *
 * 房间阶段与本地 UI 是否一致请用 `GET/POST .../room/detail` 等看 `gameStatus`，勿再依赖本接口做场景 gate。
 */
router.post(roomApiClient('/members'), async (ctx) => {
  const { roomCode, includeRoom } = ctx.request.body as {
    roomCode?: string
    includeRoom?: unknown
  }
  const userId = ctx.state.user!.id

  await handleRoomMembersRequest(ctx, {
    roomCode,
    userId,
    includeRoom: Boolean(includeRoom),
    notInRoomMessage: '无权查看该房间成员'
  })
})
