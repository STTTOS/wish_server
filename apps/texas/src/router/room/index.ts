import { isNil } from 'ramda'
import { v4 as uuidv4 } from 'uuid'
import { Texas, Player } from 'texas-poker-core'

import router from '../instance'
import { ws } from '../../server'
import { logger } from '../../logger'
import { apiPrefix } from '../../config'
import { rooms } from '../../gameCenter'
import { room, user } from '../../models'
import response from '../../utils/response'
import combinePath from '../../utils/combinePath'

const roomApi = combinePath(apiPrefix)('/room')

/**
 * 创建房间
 */
router.post(roomApi('/create'), async (ctx) => {
  const {
    lowestBetAmount,
    maximumCountOfPlayers,
    allowPlayersToWatch,
    thinkingTime
  }: {
    lowestBetAmount: number
    maximumCountOfPlayers: number
    allowPlayersToWatch: boolean
    thinkingTime?: number
  } = ctx.request.body
  const userId = ctx.state.user!.id

  const userInfo = await user.findUnique({
    where: {
      id: userId
    }
  })
  if (!userInfo) {
    response.error(ctx, 2100, '玩家不存在, 无法创建房间')
    return
  }
  if (
    [lowestBetAmount, maximumCountOfPlayers, allowPlayersToWatch, userId].some(
      isNil
    )
  ) {
    response.error(ctx, 400, '参数异常')
    return
  }
  if (!isNil(thinkingTime) && thinkingTime < 30) {
    response.error(ctx, 400, '超时时间不可小于30s')
    return
  }
  if (lowestBetAmount < 0) {
    response.error(ctx, 400, '大盲注必须大于0')
    return
  }
  if (maximumCountOfPlayers > 10) {
    response.error(ctx, 400, '玩家不能超过10个')
    return
  }

  if (
    Array.from(rooms.values())
      .map((texas) => texas.room.owner?.getUserInfo().id)
      .includes(userId)
  ) {
    response.error(ctx, 2100, '不可重复创建房间')
    return
  }

  const uuid = uuidv4()
  await room.create({
    data: {
      uuid,
      lowestBetAmount,
      allowPlayersToWatch,
      ownerId: userInfo.id,
      maximumCountOfPlayers
    }
  })
  const texas = new Texas({
    lowestBetAmount,
    maximumCountOfPlayers,
    allowPlayersToWatch,
    user: userInfo,
    thinkingTime
  })
  rooms.set(uuid, texas)
  response.success(ctx, { roomId: uuid }, '房间创建成功')
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
  try {
    if (texas.room.has(userId)) {
      response.error(ctx, 2000, '用户已经在房间中, 不可重复加入')
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
      broadCastPlayerOnSeat(player, userId)
    } else {
      broadCastPlayerOnWatch(player, texas, userId)
    }
    response.success(ctx)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    response.error(ctx, 2000, error.message)
  }
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
  try {
    const userId = ctx.state.user!.id
    const ownerId = texas.room.removeById(userId)
    if (ownerId) {
      await room.update({
        where: {
          uuid: roomId
        },
        data: {
          ownerId
        }
      })
      response.success(ctx, { ownerId })
    }
    // 最后一位玩家离开房间
    else {
      await room.delete({
        where: {
          uuid: roomId
        }
      })
      rooms.delete(roomId)
      response.success(ctx)
    }

    // 离开房间需要
    ws.remove(userId)

    logger.info('向客户端推送player-leave事件')
    ws.broadcast({
      type: 'player-leave',
      data: {
        userId,
        // TODO: 当前玩家之后的角色才会改变
        roleChangesList: texas.dealer.map((player) => {
          return {
            userId: player.getUserInfo().id,
            role: player.getRole()
          }
        })
      }
    })
    // clients.forEach((ws) => {
    //   ws.send({
    //     type: 'player-leave',
    //     data: {
    //       userId,
    //       // TODO: 当前玩家之后的角色才会改变
    //       roleChangesList: texas.dealer.map((player) => {
    //         return {
    //           userId: player.getUserInfo().id,
    //           role: player.getRole()
    //         }
    //       })
    //     }
    //   })
    // })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    response.error(ctx, 2000, error.message)
  }
})

function broadCastPlayerOnSeat(player: Player, selfId: number) {
  ws.broadcastExcept(selfId, {
    type: 'player-on-seat',
    data: {
      userInfo: player.getUserInfo(),
      role: player.getRole()
    }
  })
  // clients.forEach((ws, id) => {
  //   // 向其他玩家推送
  //   if (id === selfId) return

  //   logger.info('向客户端推送player-on-seat事件')
  //   ws.send({
  //     type: 'player-on-seat',
  //     data: {
  //       userInfo: player.getUserInfo(),
  //       role: player.getRole()
  //     }
  //   })
  // })
}

function broadCastPlayerOnWatch(player: Player, texas: Texas, selfId: number) {
  logger.info('向客户端推送player-on-watch事件')
  ws.broadcastExcept(selfId, {
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
  broadCastPlayerOnSeat(player, userId)
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
  broadCastPlayerOnWatch(player, texas, userId)
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

  await room.delete({
    where: {
      uuid: roomId
    }
  })
  rooms.delete(roomId)
  response.success(ctx, null, '删除成功')
})

// 获取所有房间
router.post(roomApi('/all'), async (ctx) => {
  const allRooms = await room.findMany()

  response.success(
    ctx,
    allRooms.map(({ uuid }) => {
      return {
        id: uuid,
        ...rooms.get(uuid)?.room.getBaseInfo()
      }
    })
  )
})

router.post(roomApi('/clear'), async (ctx) => {
  await room.deleteMany()

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
