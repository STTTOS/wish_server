import dayjs from 'dayjs'

import router from '../instance'
import { ws } from '../../server'
import { room } from '../../models'
import response from '../../utils/response'
import combinePath from '../../utils/combinePath'
import { HTTP_STATUS } from '../../constants/httpStatus'
import { timeFormat, apiPrefixClient } from '../../config'
import { respondFromApiResult } from '../../utils/respondFromApiResult'
import {
  RoomJoinFacade,
  RoomQuitFacade,
  RoomKickFacade,
  RoomCreateFacade,
  RoomMembersFacade,
  WaitingRoomGateway
} from './services/flow'

const roomApiClient = combinePath(apiPrefixClient)('/room')

const roomMembersFacade = new RoomMembersFacade(new WaitingRoomGateway(ws))
const roomCreateFacade = new RoomCreateFacade(new WaitingRoomGateway(ws))
const roomJoinFacade = new RoomJoinFacade(new WaitingRoomGateway(ws))
const roomQuitFacade = new RoomQuitFacade(new WaitingRoomGateway(ws))
const roomKickFacade = new RoomKickFacade(new WaitingRoomGateway(ws))

/**
 * 客户端创建房间
 */
router.post(roomApiClient('/create'), async (ctx) => {
  const userId = ctx.state.user!.id
  const { lowestBetAmount, thinkingTime, isPrivate, initialChips } = (ctx
    .request.body ?? {}) as Record<string, unknown>
  const result = await roomCreateFacade.execute({
    userId,
    lowestBetAmount,
    thinkingTime,
    isPrivate,
    initialChips
  })
  respondFromApiResult(ctx, result, { okMessage: '房间创建成功' })
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
          avatarKey: true,
          pokerBackgroundKey: true
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
      members,
      gameStatus
    }) => {
      return {
        id,
        code,
        owner: {
          ...owner,
          pokerBackgroundKey: owner.pokerBackgroundKey ?? 'default'
        },
        initialChips,
        thinkingTime,
        gameStatus,
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

  respondFromApiResult(ctx, result, { okMessage: '加入成功', okData: null })
})

// 客户端：退出房间（幂等：房间已删、或已不在成员表中、或重复调用均返回成功）
router.post(roomApiClient('/quit'), async (ctx) => {
  const { roomCode } = ctx.request.body as { roomCode?: unknown }
  const userId = ctx.state.user!.id

  const result = await roomQuitFacade.execute({ roomCode, userId })
  respondFromApiResult(ctx, result, { okMessage: '已退出房间', okData: null })
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
  respondFromApiResult(ctx, result, { okMessage: '已踢出该玩家', okData: null })
})

// 客户端：查询房间详情（思考时间、是否公开、大盲注）
router.post(roomApiClient('/detail'), async (ctx) => {
  const { roomCode }: { roomCode?: string } = ctx.request.body

  if (!roomCode || !roomCode.trim()) {
    response.error(ctx, HTTP_STATUS.BAD_REQUEST, '参数异常：需要 roomCode')
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
          avatarKey: true,
          pokerBackgroundKey: true
        }
      }
    }
  })
  if (!roomInfo || roomInfo.deletedAt) {
    response.error(ctx, HTTP_STATUS.NOT_FOUND, '房间不存在')
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
    owner: {
      ...owner,
      pokerBackgroundKey: owner.pokerBackgroundKey ?? 'default'
    },
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
    respondFromApiResult(ctx, result)
    return
  }
  response.success(ctx, result.data.members)
})
