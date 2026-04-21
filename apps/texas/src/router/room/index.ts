import dayjs from 'dayjs'

import router from '../instance'
import { ws } from '../../server'
import { room } from '../../models'
import response from '../../utils/response'
import combinePath from '../../utils/combinePath'
import { HTTP_STATUS } from '../../constants/httpStatus'
import { timeFormat, apiPrefixClient } from '../../config'
import { roomPlaySessionFromGameStatus } from './roomPlaySession'
import { JoinGameUseCase } from '../game/services/joinGameUseCase'
import { respondFromApiResult } from '../../utils/respondFromApiResult'
import {
  RoomJoinFacade,
  RoomQuitFacade,
  RoomKickFacade,
  RoomEnterFacade,
  RoomCreateFacade,
  RoomMembersFacade,
  WaitingRoomGateway
} from './services/flow'

const roomApiClient = combinePath(apiPrefixClient)('/room')

const roomMembersFacade = new RoomMembersFacade(new WaitingRoomGateway(ws))
const roomCreateFacade = new RoomCreateFacade(new WaitingRoomGateway(ws))
const roomJoinFacade = new RoomJoinFacade(new WaitingRoomGateway(ws))
const joinGameUseCaseForEnter = new JoinGameUseCase()
const roomEnterFacade = new RoomEnterFacade(
  roomJoinFacade,
  joinGameUseCaseForEnter
)
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
        // gameStatus,
        playSession: roomPlaySessionFromGameStatus(gameStatus),
        lowestBetAmount,
        createdAt: dayjs(createdAt).format(timeFormat),
        memberCount: members.length
      }
    }
  )
  response.success(ctx, result)
})

/**
 * 客户端：统一「进房」入口（`roomCode`）。服务端按 `gameStatus` 分派：`waiting` → 等房入表；否则 → 对局入桌（同 `game/join`）。
 * 成功 `data`：`roomId`、`gameStatus`、`joinedAs`、`gameRuntimeAttached`。
 */
router.post(roomApiClient('/enter'), async (ctx) => {
  const { roomCode } = ctx.request.body as { roomCode?: unknown }
  const userId = ctx.state.user!.id
  const normalizedRoomCode = typeof roomCode === 'string' ? roomCode : ''

  const result = await roomEnterFacade.execute({
    roomCode: normalizedRoomCode,
    userId
  })
  respondFromApiResult(ctx, result, { okMessage: '加入成功' })
})

/**
 * 客户端：通过房间代码加入房间（**仅 `gameStatus === 'waiting'`**；写 `RoomMember` + 等待房 WS）。
 * 对局已开始请用 `POST /game/join`（`roomId`）或统一入口 `POST /room/enter`。成功 `data`：`roomId`、`gameStatus`、`joinedAs`、`gameRuntimeAttached`。
 */
router.post(roomApiClient('/join'), async (ctx) => {
  const { roomCode } = ctx.request.body as { roomCode?: unknown }
  const userId = ctx.state.user!.id

  const normalizedRoomCode = typeof roomCode === 'string' ? roomCode : ''

  const result = await roomJoinFacade.execute({
    roomCode: normalizedRoomCode,
    userId
  })

  respondFromApiResult(ctx, result, { okMessage: '加入成功' })
})

// 客户端：退出房间（幂等：房间已删、或已不在成员表中、或重复调用均返回成功）
router.post(roomApiClient('/quit'), async (ctx) => {
  const { roomId } = ctx.request.body as { roomId?: unknown }
  const userId = ctx.state.user!.id

  const result = await roomQuitFacade.execute({ roomId, userId })
  respondFromApiResult(ctx, result, { okMessage: '已退出房间', okData: null })
})

// 客户端：房主踢人
router.post(roomApiClient('/kick'), async (ctx) => {
  const { roomId, targetUserId } = ctx.request.body as {
    roomId?: unknown
    targetUserId?: unknown
  }
  const operatorId = ctx.state.user!.id

  const result = await roomKickFacade.execute({
    roomId,
    targetUserId,
    operatorId
  })
  respondFromApiResult(ctx, result, { okMessage: '已踢出该玩家', okData: null })
})

// 客户端：查询房间详情（思考时间、是否公开、大盲注）
router.post(roomApiClient('/detail'), async (ctx) => {
  const roomId = Number((ctx.request.body as { roomId?: unknown })?.roomId)
  if (!Number.isFinite(roomId) || roomId <= 0) {
    response.error(ctx, HTTP_STATUS.BAD_REQUEST, '参数异常：需要 roomId')
    return
  }

  const roomInfo = await room.findUnique({
    where: {
      id: roomId
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
    // gameStatus,
    playSession: roomPlaySessionFromGameStatus(gameStatus),
    isPrivate,
    thinkingTime,
    initialChips,
    lowestBetAmount
  })
})

/**
 * 客户端：查询房间成员列表（含 `isOnline` / `isWaitingRoomOnline`）。
 * Body: `roomId`（必填）。房间摘要请用 `.../room/detail`。
 */
router.post(roomApiClient('/members'), async (ctx) => {
  const roomId = Number((ctx.request.body as { roomId?: unknown })?.roomId)
  const userId = ctx.state.user!.id

  const result = await roomMembersFacade.execute({
    roomId,
    userId
  })
  if (!result.ok) {
    respondFromApiResult(ctx, result)
    return
  }
  response.success(ctx, result.data.members)
})
