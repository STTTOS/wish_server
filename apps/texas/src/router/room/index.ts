import dayjs from 'dayjs'
import { isNil } from 'ramda'
import { Prisma } from '@prisma/texas-client'
import { Texas, Player } from 'texas-poker-core'

import router from '../instance'
import { ws } from '../../server'
import { logger } from '../../logger'
import response from '../../utils/response'
import combinePath from '../../utils/combinePath'
import { rooms, leaveRoom } from '../../gameCenter'
import { room, user, roomMember } from '../../models'
import { generateRoomCode } from '../../utils/roomCode'
import { apiPrefix, timeFormat, apiPrefixClient } from '../../config'

const roomApi = combinePath(apiPrefix)('/room')

const roomApiClient = combinePath(apiPrefixClient)('/room')

/** 客户端房间 WS 订阅通道前缀，前端连接时 roomId 传该字符串即可收到加入/退出推送 */
const CLIENT_ROOM_WS_PREFIX = 'client-room:'
function getClientRoomChannel(roomId: number): string {
  return CLIENT_ROOM_WS_PREFIX + roomId
}

/**
 * 客户端创建房间
 */
router.post(roomApiClient('/create'), async (ctx) => {
  const { lowestBetAmount, thinkingTime, isPrivate }: Prisma.RoomCreateInput =
    ctx.request.body
  const userId = ctx.state.user!.id

  if (!userId) {
    response.error(ctx, 401, '用户未登录')
    return
  }
  if ([lowestBetAmount, thinkingTime, isPrivate].some(isNil)) {
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

  if (thinkingTime < 10) {
    response.error(ctx, 2100, '思考时间不可小于10s')
    return
  }

  if (!Number.isInteger(lowestBetAmount) || lowestBetAmount <= 0) {
    response.error(ctx, 2100, '盲注金额必须为整数且大于0')
    return
  }

  const roomExisted = await room.findFirst({
    where: {
      ownerId: userId
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
          avatar: true
        }
      }
    }
  })
  const result = rooms.map(
    ({ id, code, lowestBetAmount, thinkingTime, createdAt, owner }) => {
      return {
        id,
        code,
        owner,
        thinkingTime,
        lowestBetAmount,
        createdAt: dayjs(createdAt).format(timeFormat)
      }
    }
  )
  response.success(ctx, result)
})

const CLIENT_ROOM_MAX_PLAYERS = 10

// 客户端：通过房间代码加入房间
router.post(roomApiClient('/join'), async (ctx) => {
  const { code }: { code?: string } = ctx.request.body
  const userId = ctx.state.user?.id

  if (!userId) {
    response.error(ctx, 401, '用户未登录')
    return
  }
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
  if (!roomInfo) {
    response.error(ctx, 2000, '房间不存在或房间代码错误')
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
      room: { id: { not: roomInfo.id } }
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

  await roomMember.create({
    data: { roomId: roomInfo.id, userId }
  })

  const memberPayload = {
    userId: joinUser.id,
    name: joinUser.name,
    avatar: joinUser.avatar,
    joinedAt: dayjs().format(timeFormat),
    isOwner: roomInfo.ownerId === joinUser.id
  }
  ws.broadcast(getClientRoomChannel(roomInfo.id), {
    type: 'client-room-member-joined',
    data: memberPayload
  })

  response.success(
    ctx,
    {
      roomId: roomInfo.id,
      code: roomInfo.code,
      lowestBetAmount: roomInfo.lowestBetAmount,
      thinkingTime: roomInfo.thinkingTime,
      owner: {
        id: roomInfo.owner.id,
        name: roomInfo.owner.name,
        avatar: roomInfo.owner.avatar
      }
    },
    '加入成功'
  )
})

// 客户端：退出房间
router.post(roomApiClient('/quit'), async (ctx) => {
  const { roomId }: { roomId?: number } = ctx.request.body
  const userId = ctx.state.user?.id

  if (!userId) {
    response.error(ctx, 401, '用户未登录')
    return
  }
  if (roomId == null) {
    response.error(ctx, 400, '参数异常：需要 roomId')
    return
  }

  const compoundKey = { roomId, userId }
  // Prisma 复合唯一键名为 roomId_userId，非 camelCase
  const member = await roomMember.findUnique({
    where: { roomId_userId: compoundKey }, // eslint-disable-line camelcase
    include: { room: true }
  })
  if (!member) {
    response.error(ctx, 2000, '你不在该房间中')
    return
  }

  await roomMember.delete({
    where: { roomId_userId: compoundKey } // eslint-disable-line camelcase
  })

  ws.broadcast(getClientRoomChannel(roomId), {
    type: 'client-room-member-left',
    data: { userId }
  })

  response.success(ctx, null, '已退出房间')
})

// 客户端：房主踢人
router.post(roomApiClient('/kick'), async (ctx) => {
  const { roomId, targetUserId }: { roomId?: number; targetUserId?: number } =
    ctx.request.body
  const operatorId = ctx.state.user?.id

  if (!operatorId) {
    response.error(ctx, 401, '用户未登录')
    return
  }
  if (roomId == null || targetUserId == null) {
    response.error(ctx, 400, '参数异常：需要 roomId 和 targetUserId')
    return
  }

  const roomInfo = await room.findUnique({
    where: { id: roomId }
  })
  if (!roomInfo) {
    response.error(ctx, 2000, '房间不存在')
    return
  }
  if (roomInfo.ownerId !== operatorId) {
    response.error(ctx, 403, '仅房主可以踢人')
    return
  }
  if (roomInfo.ownerId === targetUserId) {
    response.error(ctx, 400, '不能踢出房主')
    return
  }

  const compoundKey = { roomId, userId: targetUserId }
  const targetMember = await roomMember.findUnique({
    where: { roomId_userId: compoundKey } // eslint-disable-line camelcase
  })
  if (!targetMember) {
    response.error(ctx, 2000, '该用户不在房间中')
    return
  }

  await roomMember.delete({
    where: { roomId_userId: compoundKey } // eslint-disable-line camelcase
  })

  ws.broadcast(getClientRoomChannel(roomId), {
    type: 'client-room-member-left',
    data: { userId: targetUserId }
  })

  response.success(ctx, null, '已踢出该玩家')
})

// 客户端：查询房间详情（思考时间、是否公开、大盲注）
router.post(roomApiClient('/detail'), async (ctx) => {
  const { roomId }: { roomId?: number } = ctx.request.body

  if (roomId == null) {
    response.error(ctx, 400, '参数异常：需要 roomId')
    return
  }

  const roomInfo = await room.findUnique({
    where: { id: roomId },
    include: {
      owner: {
        select: {
          id: true,
          name: true,
          avatar: true
        }
      }
    }
  })
  if (!roomInfo) {
    response.error(ctx, 2000, '房间不存在')
    return
  }
  const { id, code, isPrivate, thinkingTime, lowestBetAmount, owner } = roomInfo

  response.success(ctx, {
    id,
    code,
    owner,
    isPrivate,
    thinkingTime,
    lowestBetAmount
  })
})

// 客户端：查询房间下所有成员
router.post(roomApiClient('/members'), async (ctx) => {
  const { roomId }: { roomId?: number } = ctx.request.body

  if (roomId == null) {
    response.error(ctx, 400, '参数异常：需要 roomId')
    return
  }

  const roomInfo = await room.findUnique({
    where: { id: roomId }
  })
  if (!roomInfo) {
    response.error(ctx, 2000, '房间不存在')
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
    avatar: u.avatar,
    joinedAt: dayjs(joinedAt).format(timeFormat),
    isOwner: roomInfo.ownerId === u.id
  }))

  response.success(ctx, result)
})

router.post(roomApi('/join/:roomId'), async (ctx) => {
  const roomId = ctx.params.roomId

  const texas = rooms.get(roomId)
  if (!texas) {
    response.error(ctx, 2000, '房间不存在')
    return
  }

  // TODO: 以后这个方法根据登录人
  // const player = ctx.state.user!
  const { userId } = ctx.request.body

  const userInfo = await user.findUnique({
    where: { id: userId }
  })
  if (!userInfo) {
    response.error(ctx, 2000, '用户不存在')
    return
  }
  if (texas.room.has(userId)) {
    response.error(ctx, 2000, '你已经在房间中, 不可重复加入')
    return
  }

  // 如果当前人正在别的房间里, 则不可再加入新的房间
  if (
    Array.from(rooms.entries())
      .filter(([id]) => id !== roomId)
      .some(([, texas]) => texas.room.has(userId))
  ) {
    response.error(ctx, 2000, '你已经在别的房间中, 请先退出再加入')
    return
  }

  const player = texas.createPlayer(userInfo)
  texas.room.join(player)
  if (texas.room.getPlayerSeatStatus(player) === 'on-set') {
    broadCastPlayerOnSeat(roomId, player, userId)
  } else {
    broadCastPlayerOnWatch(roomId, player, texas, userId)
  }
  response.success(ctx)
})

router.post(roomApi('/quit/:roomId'), async (ctx) => {
  const roomId = ctx.params.roomId
  const texas = rooms.get(roomId)
  if (!texas) {
    response.error(ctx, 2000, '房间不存在')
    return
  }
  if (texas.controller.status !== 'waiting') {
    response.error(ctx, 2000, '游戏正在进行中, 不可退出')
    return
  }
  const userId = ctx.state.user!.id
  if (!texas.room.has(userId)) {
    response.error(ctx, 2000, '你不在当前房间中')
    return
  }

  const ownerId = texas.room.removeById(userId)
  leaveRoom(roomId, userId)
  if (ownerId) {
    // await room.update({
    //   where: {
    //     uuid: roomId
    //   },
    //   data: {
    //     ownerId
    //   }
    // })
    logger.info('向客户端推送player-leave事件')
    ws.broadcast(roomId, {
      type: 'player-leave',
      data: {
        userId,
        ownerId,
        // TODO: 当前玩家之后的角色才会改变
        roleChangesList: texas.dealer.map((player) => {
          return {
            userId: player.id,
            role: player.getRole()
          }
        })
      }
    })
    response.success(ctx)
  }
  // 最后一位玩家离开房间
  else {
    // await room.delete({
    //   where: {
    //     uuid: roomId
    //   }
    // })

    // when the last player leave room
    // need to clear the texas instance
    texas.reset()
    rooms.delete(roomId)
    response.success(ctx)
  }
})

function broadCastPlayerOnSeat(roomId: string, player: Player, selfId: number) {
  ws.broadcastExcept(roomId, selfId, {
    type: 'player-on-seat',
    data: {
      userInfo: player.getUserInfo(),
      role: player.getRole(),
      status: 'online'
    }
  })
}

function broadCastPlayerOnWatch(
  roomId: string,
  player: Player,
  texas: Texas,
  selfId: number
) {
  logger.info('向客户端推送player-on-watch事件')
  ws.broadcastExcept(roomId, selfId, {
    type: 'player-on-watch',
    data: {
      userId: player.getUserInfo().id,
      roleChangesList: texas.dealer.map((player) => {
        return {
          userInfo: {
            id: player.getUserInfo().id
          },
          role: player.getRole()
        }
      })
    }
  })
}
router.post(roomApi('/seat/:roomId'), async (ctx) => {
  const roomId = ctx.params.roomId

  const userId = ctx.state.user!.id
  const texas = rooms.get(roomId)

  if (!texas) {
    response.error(ctx, 2000, '房间不存在')
    return
  }
  texas?.room.seatById(userId)

  const player = texas.room.getPlayerById(userId)!
  broadCastPlayerOnSeat(roomId, player, userId)
  response.success(ctx)
})
// 从坐席到观战席
router.post(roomApi('/watch/:roomId'), async (ctx) => {
  const roomId = ctx.params.roomId

  const userId = ctx.state.user!.id
  const texas = rooms.get(roomId)

  if (!texas) {
    response.error(ctx, 2000, '房间不存在')
    return
  }
  texas?.room.watchById(userId)
  const player = texas.room.getPlayerById(userId)!
  broadCastPlayerOnWatch(roomId, player, texas, userId)
  response.success(ctx)
})

// 获取房间下所有玩家信息
router.post(roomApi('/allPlayers/:roomId'), async (ctx) => {
  const roomId = ctx.params.roomId
  if (!roomId) {
    response.error(ctx, 400, '参数异常')
    return
  }
  const texas = rooms.get(roomId)

  const [playersOnSeat, playersHang] = (['on-set', 'hang'] as const).map(
    (status) =>
      texas?.room.getPlayersBySeatStatus(status).map((player) => {
        return {
          userInfo: player.getUserInfo(),
          role: player.getRole()
        }
      })
  )
  response.success(ctx, {
    playersOnSeat,
    playersHang
  })
})

router.post(roomApi('/delete/:roomId'), async (ctx) => {
  const roomId = ctx.params.roomId
  if (!roomId) {
    response.error(ctx, 400, '参数错误')
    return
  }

  const texas = rooms.get(roomId)
  if (!texas) {
    response.error(ctx, 2000, '房间不存在')
    return
  }

  const ownerId = texas?.room.owner.getUserInfo().id
  if (ownerId !== ctx.state.user!.id) {
    response.error(ctx, 401, '非法操作')
    return
  }

  // 客户端房间使用软删除, 这里不删除数据库中的 Room 记录
  try {
    // 强制结束游戏
    texas.end()
  } catch (error) {
    // nothing to do
  }
  rooms.delete(roomId)
  response.success(ctx, null, '删除成功')
})

// 获取所有房间
router.post(roomApi('/all'), async (ctx) => {
  response.success(
    ctx,
    [...rooms.entries()].map(([id, texas]) => {
      return {
        id,
        ...texas.room.getBaseInfo()
      }
    })
  )
})

router.post(roomApi('/clear'), async (ctx) => {
  // await room.deleteMany()

  rooms.forEach((texas) => {
    try {
      texas.end()
      texas.reset()
    } catch (error) {
      // nothing to do
    }
  })
  rooms.clear()
  response.success(ctx)
})
