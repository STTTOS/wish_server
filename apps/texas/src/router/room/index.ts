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
    userId: number
    lowestBetAmount: number
    maximumCountOfPlayers: number
    allowPlayersToWatch: boolean
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
      .map((texas) => texas.room.owner?.getUserInfo().id)
      .includes(userId)
  ) {
    response.error(ctx, 2000, '不可重复创建房间')
    return
  }
  const userInfo = await user.findUnique({
    where: {
      id: userId
    }
  })
  if (!userInfo) {
    response.error(ctx, 2000, '游戏数据异常')
    return
  }

  const roomId = uuidv4()
  const texas = initialGame({
    lowestBetAmount,
    maximumCountOfPlayers,
    allowPlayersToWatch,
    user: userInfo
  })
  rooms.set(roomId, texas)
  response.success(ctx, { roomId }, '房间创建成功')
})

router.post(roomApi('/join/:roomId'), async (ctx) => {
  const roomId = ctx.params.roomId
  // const {} = ctx.request.body

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
    texas.room.join(texas.createPlayer(userInfo))
    response.success(ctx)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    response.error(ctx, 2000, error.message)
  }
})

router.post(roomApi('/seat/:roomId'), async (ctx) => {
  const roomId = ctx.params.roomId

  const { userId }: { userId: number } = ctx.request.body
  if (!userId) {
    response.error(ctx, 400, '参数错误')
    return
  }
  const texas = rooms.get(roomId)

  if (!texas) {
    response.error(ctx, 2000, '房间不存在')
    return
  }
  try {
    texas?.room.seatById(userId)
    response.success(ctx)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    response.error(ctx, 2000, error.message)
  }
})

// 获取房间下所有玩家信息
router.post(roomApi('/allPlayers/:roomId'), async (ctx) => {
  const roomId = ctx.params.roomId
  // const { roomId }: { roomId: string } = ctx.request.body
  if (!roomId) {
    response.error(ctx, 400, '参数异常')
    return
  }
  const texas = rooms.get(roomId)

  const [playersOnSeat, playersHang] = (['on-set', 'hang'] as const).map(
    (status) =>
      texas?.room
        .getPlayersBySeatStatus(status)
        .map((player) => player.getUserInfo())
  )
  response.success(ctx, {
    playersOnSeat,
    playersHang
  })
})
router.post(roomApi('delete/:roomId'), async (ctx) => {
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

  rooms.delete(roomId)
  response.success(ctx, null, '删除成功')
})

// 获取所有房间
router.post(roomApi('/all'), async (ctx) => {
  response.success(
    ctx,
    Array.from(rooms.entries()).map(([id, texas]) => {
      return {
        id,
        ...texas.room.getBaseInfo()
      }
    })
  )
})
