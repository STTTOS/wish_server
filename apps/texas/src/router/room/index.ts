import { isNil } from 'ramda'
import { v4 as uuidv4 } from 'uuid'
import { initialGame } from 'texas-poker-core'

import router from '../instance'
import { user } from '../../models'
import { apiPrefix } from '../../config'
import { rooms } from '../../gameCenter'
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
    allowPlayersToWatch
  }: {
    lowestBetAmount: number
    maximumCountOfPlayers: number
    allowPlayersToWatch: boolean
    userId: number
  } = ctx.request.body
  const userId = ctx.state.user!.id

  if (
    [lowestBetAmount, maximumCountOfPlayers, allowPlayersToWatch, userId].some(
      isNil
    )
  ) {
    response.error(ctx, 400, '参数异常')
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
      .map((item) => item.ownerId)
      .includes(userId)
  ) {
    response.error(ctx, 400, '不可重复创建房间')
    return
  }

  const roomId = uuidv4()
  const texas = initialGame({
    lowestBetAmount,
    maximumCountOfPlayers,
    allowPlayersToWatch
  })
  rooms.set(roomId, { texas, ownerId: userId })

  const userInfo = await user.findUnique({
    where: {
      id: userId
    }
  })
  if (!userInfo) {
    response.error(ctx, 500, '游戏数据异常')
    return
  }
  const player = texas.createPlayer(userInfo)
  texas.room.addPlayer(player)
  response.success(ctx, { roomId }, '房间创建成功')
})

router.post(roomApi('/join/:roomId'), async (ctx) => {
  const roomId = ctx.params.roomId
  // const {} = ctx.request.body

  const texas = rooms.get(roomId)?.texas
  if (!texas) {
    response.error(ctx, 500, '房间不存在')
    return
  }
  // TODO: 以后这个方法根据登录人
  // const player = ctx.state.user!
  const { userId } = ctx.request.body

  if (texas.room.has(userId)) {
    response.error(ctx, 400, '你已在房间中, 不可重复加入')
    return
  }
  const userInfo = await user.findUnique({
    where: {
      id: userId
    }
  })
  if (!userInfo) {
    response.error(ctx, 500, '服务器数据异常')
    return
  }
  texas.room.addPlayer(texas.createPlayer(userInfo))
  // 此处需要使用w推送消息
  response.success(ctx)
})

// 获取房间下所有玩家信息
router.post(roomApi('/allPlayers/:roomId'), async (ctx) => {
  const roomId = ctx.params.roomId
  // const { roomId }: { roomId: string } = ctx.request.body
  if (!roomId) {
    response.error(ctx, 400, '参数异常')
    return
  }
  const players = rooms.get(roomId)?.texas.dealer.map((player) => {
    return {
      ...player.getUserInfo(),
      role: player.getRole()
    }
  })
  response.success(ctx, players)
})

// 获取所有房间
router.post(roomApi('/all'), async (ctx) => {
  response.success(
    ctx,
    Array.from(rooms.entries()).map(([roomId, { ownerId }]) => {
      return {
        roomId,
        ownerId
      }
    })
  )
})
