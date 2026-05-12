import dayjs from 'dayjs'

import router from '../instance'
import { ws } from '../../server'
import prisma, { room } from '../../models'
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
  const {
    type,
    lowestBetAmount,
    thinkingTime,
    isPrivate,
    initialChips,
    sevenTwoBonusEnabled
  } = (ctx.request.body ?? {}) as Record<string, unknown>
  const result = await roomCreateFacade.execute({
    userId,
    type,
    lowestBetAmount,
    thinkingTime,
    isPrivate,
    initialChips,
    sevenTwoBonusEnabled
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
          pokerBackgroundKey: true,
          tableBackgroundKey: true
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
      activeCode,
      lowestBetAmount,
      thinkingTime,
      createdAt,
      owner,
      initialChips,
      members,
      gameStatus,
      tableType,
      sevenTwoBonusEnabled
    }) => {
      return {
        id,
        code: activeCode ?? '',
        owner: {
          ...owner,
          pokerBackgroundKey: owner.pokerBackgroundKey
        },
        initialChips,
        thinkingTime,
        // gameStatus,
        playSession: roomPlaySessionFromGameStatus(gameStatus),
        lowestBetAmount,
        tableType,
        sevenTwoBonusEnabled,
        createdAt: dayjs(createdAt).format(timeFormat),
        memberCount: members.length
      }
    }
  )
  response.success(ctx, result)
})

/**
 * 客户端：通过房间代码解析 `roomId`（代码仅作为入口凭证；后续链路统一用 roomId）。
 */
router.post(roomApiClient('/resolve'), async (ctx) => {
  const { roomCode } = (ctx.request.body ?? {}) as { roomCode?: unknown }
  const normalizedCode =
    typeof roomCode === 'string' ? roomCode.trim().toUpperCase() : ''
  if (!normalizedCode) {
    response.error(ctx, HTTP_STATUS.BAD_REQUEST, '参数异常：需要 roomCode')
    return
  }
  const roomInfo = await room.findUnique({
    where: { activeCode: normalizedCode },
    select: { id: true, deletedAt: true }
  })
  if (!roomInfo || roomInfo.deletedAt) {
    response.error(ctx, HTTP_STATUS.NOT_FOUND, '房间不存在或房间代码错误')
    return
  }
  response.success(ctx, { roomId: roomInfo.id })
})

/**
 * 客户端：杀进程恢复前校验是否仍为 `RoomMember`。
 * 若已因离线踢出等不再在表中，应跳过 `POST /room/enter`（避免无意义请求；服务端 `room/enter` 对局中也会走 `game/join` 并可能写回成员）。
 * Body: `{ roomId }`。成功 `data`：`{ isMember: boolean }`。
 */
router.post(roomApiClient('/resumeMembership'), async (ctx) => {
  const raw = (ctx.request.body as { roomId?: unknown })?.roomId
  const roomId = typeof raw === 'number' ? raw : Number(raw ?? Number.NaN)
  const userId = ctx.state.user!.id

  if (!Number.isFinite(roomId) || roomId <= 0) {
    response.error(ctx, HTTP_STATUS.BAD_REQUEST, '参数错误')
    return
  }

  const roomRow = await prisma.room.findUnique({
    where: { id: roomId },
    select: { id: true, deletedAt: true }
  })
  if (!roomRow || roomRow.deletedAt) {
    response.success(ctx, { isMember: false })
    return
  }

  const member = await prisma.roomMember.findUnique({
    where: { roomId_userId: { roomId, userId } }, // eslint-disable-line camelcase
    select: { userId: true }
  })
  response.success(ctx, { isMember: Boolean(member) })
})

/**
 * 客户端：统一「进房」入口（`roomId` 优先，兼容 `roomCode`）。
 * 服务端按 `gameStatus` 分派：`waiting` → 等房入表；否则 → 对局入桌（同 `game/join`）。
 * 成功 `data`：`roomId`、`gameStatus`、`joinedAs`、`gameRuntimeAttached`。
 */
router.post(roomApiClient('/enter'), async (ctx) => {
  const { roomCode, roomId } = ctx.request.body as {
    roomCode?: unknown
    roomId?: unknown
  }
  const userId = ctx.state.user!.id
  const normalizedRoomCode = typeof roomCode === 'string' ? roomCode : ''
  const normalizedRoomId =
    typeof roomId === 'number' ? roomId : Number(roomId ?? Number.NaN)

  const result = await roomEnterFacade.execute({
    roomCode: normalizedRoomCode,
    roomId: normalizedRoomId,
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
          pokerBackgroundKey: true,
          tableBackgroundKey: true
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
    activeCode,
    isPrivate,
    thinkingTime,
    lowestBetAmount,
    owner,
    gameStatus,
    initialChips,
    tableType,
    sevenTwoBonusEnabled
  } = roomInfo

  response.success(ctx, {
    id,
    code: activeCode ?? '',
    owner: {
      ...owner,
      pokerBackgroundKey: owner.pokerBackgroundKey
    },
    // gameStatus,
    playSession: roomPlaySessionFromGameStatus(gameStatus),
    isPrivate,
    thinkingTime,
    initialChips,
    lowestBetAmount,
    tableType,
    sevenTwoBonusEnabled
  })
})

/**
 * 客户端：查询房间成员列表。
 * 每项含 `isOnline`（waiting-room 或 game 任一 WS 在线）与 `isWaitingRoomOnline`
 * （仅 waiting-room；与 `waiting-room-member-presence` 同源）。未连等待室 WS 时后者为 `false`。
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
