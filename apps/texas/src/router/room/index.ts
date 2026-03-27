import dayjs from 'dayjs'
import { isNil } from 'ramda'
import { Prisma } from '@prisma/texas-client'

import router from '../instance'
import { ws } from '../../server'
import response from '../../utils/response'
import combinePath from '../../utils/combinePath'
import { generateRoomCode } from '../../utils/roomCode'
import { timeFormat, apiPrefixClient } from '../../config'
import prisma, { room, user, roomMember } from '../../models'
import {
  MIN_BB,
  MIN_THINKING_TIME,
  INITIAL_CHIPS_MIN_BB_MULTIPLIER
} from '../../constants/game'

const roomApiClient = combinePath(apiPrefixClient)('/room')

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

const CLIENT_ROOM_MAX_PLAYERS = 10

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

  if (roomInfo.members.length >= CLIENT_ROOM_MAX_PLAYERS) {
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
      if (memberCount >= CLIENT_ROOM_MAX_PLAYERS) {
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
    type: 'client-room-member-joined',
    data: memberPayload
  })

  // 更新房间列表中的实时人数
  ws.broadcastRoomList({
    type: 'client-room-member-count-changed',
    data: {
      roomId: roomInfo.id,
      memberCount: memberCountAfterJoin
    }
  })

  response.success(ctx, null, '加入成功')
})

// 客户端：退出房间
router.post(roomApiClient('/quit'), async (ctx) => {
  const { roomCode }: { roomCode?: string } = ctx.request.body
  const userId = ctx.state.user!.id
  if (!roomCode || !roomCode.trim()) {
    response.error(ctx, 400, '参数异常：需要 roomCode')
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

  const roomId = roomInfo.id
  const compoundKey = { roomId, userId }
  let restCount = 0
  let deletedRoom = false
  let newOwnerId: number | null = null
  try {
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM \`Room\` WHERE id = ${roomId} FOR UPDATE`

      const latestRoom = await tx.room.findUnique({
        where: { id: roomId },
        select: { ownerId: true, gameStatus: true, deletedAt: true }
      })
      if (!latestRoom || latestRoom.deletedAt) throw new Error('房间不存在')
      if (latestRoom.gameStatus !== 'waiting') {
        throw new Error('仅等待房间状态支持退出房间')
      }

      const member = await tx.roomMember.findUnique({
        where: { roomId_userId: compoundKey } // eslint-disable-line camelcase
      })
      if (!member) throw new Error('你不在该房间中')

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

  if (newOwnerId != null) {
    ws.broadcastWaitingRoom(roomId, {
      type: 'client-room-owner-changed',
      data: {
        oldOwnerId: userId,
        newOwnerId
      }
    })
  }

  ws.broadcastWaitingRoom(roomId, {
    type: 'client-room-member-left',
    data: { userId }
  })
  if (deletedRoom) {
    ws.broadcastRoomList({
      type: 'client-room-deleted',
      data: { roomId }
    })
  } else {
    // 非最后一人退出时，更新房间列表中的实时人数
    ws.broadcastRoomList({
      type: 'client-room-member-count-changed',
      data: {
        roomId,
        memberCount: restCount
      }
    })
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
    response.error(ctx, 2000, e instanceof Error ? e.message : '踢人失败')
    return
  }

  ws.broadcastWaitingRoom(roomId, {
    type: 'client-room-member-left',
    data: { userId: targetUserId }
  })
  ws.broadcastRoomList({
    type: 'client-room-member-count-changed',
    data: {
      roomId,
      memberCount: memberCountAfterKick
    }
  })

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
    initialChips
  } = roomInfo

  response.success(ctx, {
    id,
    code,
    owner,
    isPrivate,
    thinkingTime,
    initialChips,
    lowestBetAmount
  })
})

// 客户端：查询房间下所有成员
router.post(roomApiClient('/members'), async (ctx) => {
  const { roomCode }: { roomCode?: string } = ctx.request.body
  const userId = ctx.state.user!.id

  if (!roomCode || !roomCode.trim()) {
    response.error(ctx, 400, '参数异常：需要 roomCode')
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

  const roomId = roomInfo.id

  const selfMember = await roomMember.findUnique({
    // Prisma 复合唯一键名为 roomId_userId，非 camelCase
    where: {
      // eslint-disable-next-line camelcase
      roomId_userId: {
        roomId,
        userId
      }
    }
  })
  if (!selfMember) {
    response.error(ctx, 403, '无权查看该房间成员')
    return
  }

  const members = await roomMember.findMany({
    where: { roomId },
    include: { user: true },
    orderBy: { joinedAt: 'asc' }
  })

  const result = members.map(({ joinedAt, user: u }) => ({
    userId: u.id,
    name: u.name,
    avatarUrl: u.avatarUrl,
    avatarKey: u.avatarKey,
    joinedAt: dayjs(joinedAt).format(timeFormat),
    isOwner: roomInfo.ownerId === u.id
  }))

  response.success(ctx, result)
})
