import type { WsMessage } from '../ws/ws-event-types'
import type { RoomWsMessage } from '../router/room/ws-event-types'

import { OnlineStatus } from 'texas-poker-core'
import { Server, Socket, Namespace } from 'socket.io'

import { server } from '../server'
import { logger } from '../logger'
import { isAdminUser } from '../utils/isAdminUser'
import { RoomCleanupManager } from './roomCleanupManager'
import { GameEnteringTracker } from './gameEnteringTracker'
import { isMaintenanceEnabled } from '../utils/maintenanceSwitch'
import { GameConnectionWaiterStore } from './gameConnectionWaiterStore'
import { gameRuntimeRegistry } from '../router/game/services/runtimeRegistry'
import { MAINTENANCE_CODE, MAINTENANCE_MESSAGE } from '../constants/maintenance'
import { setNextHandCountdownBroadcaster } from '../gameRuntime/nextHandCountdown'
import {
  resolveWsUserFromHandshake,
  getWsRoomIdFromHandshakeAuth
} from '../utils/wsAuth'
import {
  SOCKET_IO_PING_TIMEOUT_MS,
  SOCKET_IO_PING_INTERVAL_MS,
  WAIT_FOR_GAME_USERS_CONNECTED_TIMEOUT_MS
} from '../constants/ws'

class SocketServer {
  #io: Server
  #gameNs: Namespace
  #roomListNs: Namespace
  #waitingRoomNs: Namespace
  #gameRoomConnectWaiters = new GameConnectionWaiterStore()
  #gameEnteringTrackers = new GameEnteringTracker()
  #roomCleanupManager: RoomCleanupManager

  constructor() {
    this.#io = new Server(server, {
      cors: { origin: 'https://texas.wishufree.com' },
      // how many ms without a pong packet to consider the connection closed
      pingTimeout: SOCKET_IO_PING_TIMEOUT_MS,
      // how many ms before sending a new ping packet
      pingInterval: SOCKET_IO_PING_INTERVAL_MS
      // cors: { origin: '*' }
    })

    /**
     * 命名空间：
     * - /game        ：游戏进程 WS，使用 runtimeRegistry 的 roomId 作为房间名
     * - /room-list   ：房间列表 WS，所有连接 join 'client-room-list'
     * - /waiting-room：等待房间/客户端房间 WS，join 房间名为 roomId
     */
    this.#gameNs = this.#io.of('/game')
    this.#roomListNs = this.#io.of('/room-list')
    this.#waitingRoomNs = this.#io.of('/waiting-room')
    this.#roomCleanupManager = new RoomCleanupManager({
      getWaitingRoomSocketCount: (roomId) =>
        this.#getSocketsInWaitingRoom(roomId).length,
      onWaitingRoomDeleted: (roomId) => {
        this.broadcastRoomList({
          type: 'room-list-room-deleted',
          data: { roomId }
        } satisfies RoomWsMessage<'room-list-room-deleted'>)
      }
    })
    setNextHandCountdownBroadcaster((roomId, msg) => {
      this.broadcastGameRoom(String(roomId), msg)
    })

    this.#setupGameNamespace()
    this.#setupRoomListNamespace()
    this.#setupWaitingRoomNamespace()
  }

  get io() {
    return this.#io
  }

  #getGameUserRoomKey(userId: number) {
    return `game-user:${userId}`
  }

  /** 日志用：脱敏 token 类字段，避免整段 JWT 落盘 */
  #redactHandshakeForLog(handshake: Socket['handshake']) {
    const redact = (v: unknown): unknown => {
      if (typeof v === 'string' && v.length > 12) {
        return `${v.slice(0, 4)}…(${v.length})…${v.slice(-4)}`
      }
      if (Array.isArray(v)) return v.map(redact)
      return v
    }
    const query: Record<string, unknown> = { ...handshake.query }
    for (const k of ['token', 'access_token', 'password']) {
      if (k in query) query[k] = redact(query[k])
    }
    let auth: Record<string, unknown> | undefined
    if (handshake.auth && typeof handshake.auth === 'object') {
      auth = { ...(handshake.auth as Record<string, unknown>) }
      for (const k of ['token', 'access_token', 'password']) {
        if (k in auth) auth[k] = redact(auth[k])
      }
    }
    return {
      url: handshake.url,
      address: handshake.address,
      issued: handshake.issued,
      query,
      auth,
      authorizationHeaderPresent: Boolean(
        typeof handshake.headers.authorization === 'string' &&
          handshake.headers.authorization.length > 0
      )
    }
  }

  #logWsConnectHandshake(nspLabel: string, socket: Socket) {
    logger.info(
      `[${nspLabel}] connect handshake socketId=${socket.id} ${JSON.stringify(
        this.#redactHandshakeForLog(socket.handshake)
      )}`
    )
  }

  /**
   * /game 命名空间：与德州扑克对局相关的 WS 连接
   * 约定：
   * - auth.token / query.token / Authorization Bearer：与 HTTP 相同的登录 JWT
   * - auth.roomId: number|string（客户端房间 id，join 的房间名为 String(roomId)）
   */
  #setupGameNamespace() {
    this.#gameNs.use(async (socket, next) => {
      this.#logWsConnectHandshake('/game', socket)
      const userId = await resolveWsUserFromHandshake(socket.handshake)
      if (!userId) {
        logger.error(
          `[/game] websocket connect url:${socket.handshake.url}(missing or invalid token), connection refused`
        )
        return next(
          new Error(
            'parameters to establish connection are invalid, connection refused'
          )
        )
      }
      socket.data.userId = userId

      const maintenanceBlocked = await this.#guardMaintenance(socket)
      if (maintenanceBlocked) {
        return next(new Error(`${MAINTENANCE_CODE}:${MAINTENANCE_MESSAGE}`))
      }
      const roomId = getWsRoomIdFromHandshakeAuth(socket.handshake)
      if (roomId == null) {
        logger.error(
          `[/game] websocket connect url:${socket.handshake.url}(parameters error), connection refused`
        )
        return next(
          new Error(
            'parameters to establish connection are invalid, connection refused'
          )
        )
      }
      socket.data.roomId = roomId
      next()
    })

    this.#gameNs.on('connection', (socket) => {
      const userId = socket.data.userId as number
      const roomId = socket.data.roomId as number
      const roomKey = String(roomId)
      const userRoomKey = this.#getGameUserRoomKey(userId)

      socket.join(roomKey)
      socket.join(userRoomKey)
      socket.send({ type: 'initial connect', data: null })

      this.#handleGameRoomConnect(roomKey, userId)
      this.#notifyGameRoomWaiters(roomKey)
      this.#notifyEnteringProgress(roomKey)

      const onLeave = () => {
        this.#handleGameRoomDisconnect(roomKey, userId)
        this.#notifyGameRoomWaiters(roomKey)
        this.#notifyEnteringProgress(roomKey)
      }

      socket.on('disconnect', (reason) => {
        onLeave()
        logger.info(
          '[/game] client disconnect, id:',
          socket.id,
          'reason',
          reason
        )
      })

      socket.on('error', (error) => {
        onLeave()
        logger.error('[/game] WebSocket connect error:', error)
      })
    })
  }

  /**
   * /room-list 命名空间：房间列表订阅
   * 约定：
   * - auth.token / query.token / Authorization Bearer：与 HTTP 相同的登录 JWT
   * - 所有连接 join 同一个房间 'client-room-list'
   */
  #setupRoomListNamespace() {
    this.#roomListNs.use(async (socket, next) => {
      this.#logWsConnectHandshake('/room-list', socket)
      const userId = await resolveWsUserFromHandshake(socket.handshake)
      if (!userId) {
        logger.error(
          `[/room-list] websocket connect url:${socket.handshake.url}(missing or invalid token), connection refused`
        )
        return next(
          new Error(
            'parameters to establish connection are invalid, connection refused'
          )
        )
      }
      socket.data.userId = userId

      const maintenanceBlocked = await this.#guardMaintenance(socket)
      if (maintenanceBlocked) {
        return next(new Error(`${MAINTENANCE_CODE}:${MAINTENANCE_MESSAGE}`))
      }
      next()
    })

    this.#roomListNs.on('connection', (socket) => {
      socket.join('client-room-list')
      socket.send({ type: 'initial connect', data: null })

      socket.on('disconnect', (reason) => {
        logger.info(
          '[/room-list] client disconnect, id:',
          socket.id,
          'reason',
          reason
        )
      })

      socket.on('error', (error) => {
        logger.error('[/room-list] WebSocket connect error:', error)
      })
    })
  }

  /**
   * /waiting-room 命名空间：客户端房间/等待房间订阅
   * 约定：
   * - auth.token / query.token / Authorization Bearer：与 HTTP 相同的登录 JWT
   * - auth.roomId: number|string（客户端房间 id）
   * - 实际 join 的房间名即 String(roomId)
   */
  #setupWaitingRoomNamespace() {
    this.#waitingRoomNs.use(async (socket, next) => {
      this.#logWsConnectHandshake('/waiting-room', socket)
      const userId = await resolveWsUserFromHandshake(socket.handshake)
      if (!userId) {
        logger.error(
          `[/waiting-room] websocket connect url:${socket.handshake.url}(missing or invalid token), connection refused`
        )
        return next(
          new Error(
            'parameters to establish connection are invalid, connection refused'
          )
        )
      }
      socket.data.userId = userId

      const maintenanceBlocked = await this.#guardMaintenance(socket)
      if (maintenanceBlocked) {
        return next(new Error(`${MAINTENANCE_CODE}:${MAINTENANCE_MESSAGE}`))
      }
      const roomId = getWsRoomIdFromHandshakeAuth(socket.handshake)
      if (roomId == null) {
        logger.error(
          `[/waiting-room] websocket connect url:${socket.handshake.url}(parameters error), connection refused`
        )
        return next(
          new Error(
            'parameters to establish connection are invalid, connection refused'
          )
        )
      }
      socket.data.roomId = roomId
      next()
    })

    this.#waitingRoomNs.on('connection', (socket) => {
      const roomId = socket.data.roomId as number
      const roomKey = String(roomId)

      socket.join(roomKey)
      socket.send({ type: 'initial connect', data: null })

      const userId = socket.data.userId as number
      if (typeof userId === 'number') {
        this.#maybeBroadcastWaitingRoomPresence(
          roomKey,
          roomId,
          userId,
          socket.id,
          true
        )
      }

      socket.on('disconnect', (reason) => {
        logger.info(
          '[/waiting-room] client disconnect, id:',
          socket.id,
          'reason',
          reason
        )
        this.#onWaitingRoomSocketDropped(socket, roomKey, roomId)
      })

      socket.on('error', (error) => {
        logger.error('[/waiting-room] WebSocket connect error:', error)
        this.#onWaitingRoomSocketDropped(socket, roomKey, roomId)
      })
    })
  }

  #getSocketByIdInNamespace(namespace: Namespace, socketId: string) {
    return namespace.sockets.get(socketId) as Socket | undefined
  }

  async #guardMaintenance(socket: Socket) {
    const enabled = await isMaintenanceEnabled()
    if (!enabled) return false
    const userId = socket.data.userId as number | undefined
    const adminPassed = await isAdminUser(userId)
    if (adminPassed) return false
    logger.info(
      `ws blocked by maintenance, nsp=${socket.nsp.name}, userId=${userId ?? 0}`
    )
    return true
  }

  #getSocketsInWaitingRoom(roomId: string) {
    const socketIds = Array.from(
      this.#waitingRoomNs.adapter.rooms.get(roomId) || []
    )
    return socketIds
      .map((socketId) =>
        this.#getSocketByIdInNamespace(this.#waitingRoomNs, socketId)
      )
      .filter((socket) => !!socket) as Socket[]
  }

  /**
   * 多终端时：仅当该用户在房间内已无其它 waiting-room 连接时广播，避免误报掉线/上线。
   */
  #maybeBroadcastWaitingRoomPresence(
    roomKey: string,
    roomIdNumber: number,
    userId: number,
    socketId: string,
    online: boolean
  ) {
    const peers = this.#getSocketsInWaitingRoom(roomKey).filter(
      (s) => (s.data.userId as number) === userId && s.id !== socketId
    )
    if (peers.length > 0) return
    const msg: RoomWsMessage<'waiting-room-member-presence'> = {
      type: 'waiting-room-member-presence',
      data: { userId, online }
    }
    this.broadcastWaitingRoom(roomIdNumber, msg)
  }

  #onWaitingRoomSocketDropped(
    socket: Socket,
    roomKey: string,
    roomIdNumber: number
  ) {
    const userId = socket.data.userId as number
    if (typeof userId === 'number') {
      this.#maybeBroadcastWaitingRoomPresence(
        roomKey,
        roomIdNumber,
        userId,
        socket.id,
        false
      )
    }
    void this.#roomCleanupManager.tryCleanupWaitingRoomIfAllOffline(roomKey)
  }

  #getSocketsInGameRoom(roomId: string) {
    const socketIds = Array.from(this.#gameNs.adapter.rooms.get(roomId) || [])
    return socketIds
      .map((socketId) => this.#getSocketByIdInNamespace(this.#gameNs, socketId))
      .filter((socket) => !!socket) as Socket[]
  }

  #getUserIdsInGameRoom(roomId: string) {
    return this.#getSocketsInGameRoom(roomId)
      .map((socket) => socket?.data.userId as number)
      .filter((userId) => !!userId) as number[]
  }

  /**
   * 仅当 channel 为游戏房间（runtimeRegistry 中存在）时：标记玩家在线并广播
   */
  #handleGameRoomConnect(channel: string, userId: number) {
    const texas = gameRuntimeRegistry.getTexas(channel)
    const player = texas?.room.getPlayerById(userId)
    if (player && player.onlineStatus !== 'online') {
      player.onlineStatus = 'online'
      this.broadcastGameRoom(channel, {
        type: 'player-status-change',
        data: { user: { id: userId }, status: 'online' as OnlineStatus }
      })
    }
  }

  /**
   * 仅当 channel 为游戏房间（runtimeRegistry 中存在）时：广播玩家离线并更新 Texas 内状态
   */
  #handleGameRoomDisconnect(channel: string, userId: number) {
    if (!gameRuntimeRegistry.hasTexas(channel)) return
    this.broadcastGameRoom(channel, {
      type: 'player-status-change',
      data: { user: { id: userId }, status: 'offline' as OnlineStatus }
    })
    const texas = gameRuntimeRegistry.getTexas(channel)
    const player = texas?.room.getPlayerById(userId)
    if (player) player.onlineStatus = 'offline'

    void this.#roomCleanupManager.tryCleanupRoomIfAllOffline(channel)
  }

  /**
   * @description 向 /game 房间内所有端广播
   */
  broadcastGameRoom(roomId: string, data: Parameters<Socket['send']>[0]) {
    // TODO: 日志 payload 脱敏（与 broadcastGameToUser 一致）：game-end 的 settleList[].handPokes / pokesToReveal / bestPokes，game-stage-changed 的 pokesToReveal 等
    logger.info(
      `broadcastGameRoom, ${this.#getUserIdsInGameRoom(
        roomId
      )}, data: ${JSON.stringify(data)}`
    )
    this.#gameNs.to(roomId).emit('message', data)
  }

  /**
   * @description 向 /game 指定用户推送消息
   */
  broadcastGameToUser(userId: number, data: Parameters<Socket['send']>[0]) {
    let logPayload: unknown = data
    if (
      data &&
      typeof data === 'object' &&
      'data' in data &&
      (data as { data: unknown }).data != null &&
      typeof (data as { data: unknown }).data === 'object'
    ) {
      const inner = (data as { data: Record<string, unknown> }).data
      if ('handPokes' in inner) {
        const hand = inner.handPokes
        const n = Array.isArray(hand) ? hand.length : 0
        logPayload = {
          ...(data as Record<string, unknown>),
          data: {
            ...inner,
            handPokes: `[redacted:${n}]`
          }
        }
      }
    }
    logger.info(
      `broadcastGameToUser, ${userId}, data: ${JSON.stringify(logPayload)}`
    )
    const userRoomKey = this.#getGameUserRoomKey(userId)
    this.#gameNs.to(userRoomKey).emit('message', data)
  }

  /**
   * @description /game 自定义广播：每个端可收到不同 payload
   * 缺少 userId 的 socket（握手未完成、断线竞态等）仅跳过并打日志，避免中断整房推送。
   */
  broadcastGameEach(
    roomId: string,
    callback: (userId: number) => Parameters<Socket['send']>[0]
  ) {
    logger.info(`broadcastGameEach, ${this.#getUserIdsInGameRoom(roomId)}`)
    this.#getSocketsInGameRoom(roomId).forEach((socket) => {
      const userId = socket.data.userId as number | undefined
      if (typeof userId !== 'number') {
        logger.warn(
          `[broadcastGameEach] skip socket without userId, roomId=${roomId}, socketId=${socket.id}`
        )
        return
      }
      this.#gameNs.to(socket.id).emit('message', callback(userId))
    })
  }

  // remove(roomId: string, userId: number) {
  //   const userRoomKey = this.#getGameUserRoomKey(userId)
  //   this.#gameNs.in(userRoomKey).socketsLeave(roomId)
  // }

  /**
   * 房间列表广播（/room-list 命名空间）
   */
  broadcastRoomList(data: Parameters<Socket['send']>[0]) {
    logger.info(`broadcastRoomList, data: ${JSON.stringify(data)}`)
    this.#roomListNs.to('client-room-list').emit('message', data)
  }

  /**
   * 等待房间广播（/waiting-room 命名空间）
   * @param roomId 客户端房间 id，即 Socket.IO 房间名
   */
  broadcastWaitingRoom(roomId: number, data: Parameters<Socket['send']>[0]) {
    logger.info(
      `broadcastWaitingRoom, roomId: ${roomId}, data: ${JSON.stringify(data)}`
    )
    this.#waitingRoomNs.to(String(roomId)).emit('message', data)
  }

  /**
   * 将指定 user 从某个等待房间（/waiting-room namespace 的 Socket.IO room）移除。
   *
   * waiting-room 不维护 user->socket 映射；这里通过 room 内在线 socket 反查并 leave(roomKey)。
   */
  removeUserFromWaitingRoom(roomId: number, userId: number) {
    const roomKey = String(roomId)
    const sockets = this.#getSocketsInWaitingRoom(roomKey)
    const targets = sockets.filter((s) => (s.data.userId as number) === userId)
    if (targets.length === 0) return

    logger.info(
      `[waiting-room] removeUserFromWaitingRoom, roomId=${roomId}, userId=${userId}, sockets=${targets.length}`
    )
    targets.forEach((socket) => socket.leave(roomKey))
  }

  disconnectUserRoomSockets(roomId: number, userId: number) {
    const roomKey = String(roomId)
    const waitingTargets = this.#getSocketsInWaitingRoom(roomKey).filter(
      (s) => (s.data.userId as number) === userId
    )
    const gameTargets = this.#getSocketsInGameRoom(roomKey).filter(
      (s) => (s.data.userId as number) === userId
    )
    const targets = [...waitingTargets, ...gameTargets]
    if (targets.length === 0) return

    logger.info(
      `[room-socket-disconnect] roomId=${roomId}, userId=${userId}, sockets=${targets.length}`
    )
    targets.forEach((socket) => socket.disconnect(true))
  }

  /**
   * 当前在 `/waiting-room` 且已 join 该 `roomId` 的用户集合（与 `waiting-room-member-presence` 同源，非 DB）。
   * 供 HTTP 成员列表等接口补齐「是否在等待房 WS 在线」。
   */
  getWaitingRoomOnlineUserIds(roomId: number): Set<number> {
    const roomKey = String(roomId)
    const ids = new Set<number>()
    for (const socket of this.#getSocketsInWaitingRoom(roomKey)) {
      const uid = socket.data.userId as number | undefined
      if (typeof uid === 'number') ids.add(uid)
    }
    return ids
  }

  trackGameEntering(roomIdNumber: number, expectedUserIds: number[]) {
    const roomKey = this.#gameEnteringTrackers.set(
      roomIdNumber,
      expectedUserIds
    )
    this.#notifyEnteringProgress(roomKey)
  }

  untrackGameEntering(roomIdNumber: number) {
    this.#gameEnteringTrackers.delete(roomIdNumber)
  }

  #notifyEnteringProgress(roomKey: string) {
    const tracker = this.#gameEnteringTrackers.get(roomKey)
    if (!tracker) return

    const connectedUserIds = this.getConnectedGameRoomUserIds(roomKey).filter(
      (id) => tracker.expected.has(id)
    )
    const msg: WsMessage<'game-entering-progress'> = {
      type: 'game-entering-progress',
      data: {
        roomId: tracker.roomIdNumber,
        expectedUserIds: Array.from(tracker.expected),
        connectedUserIds
      }
    }
    this.broadcastWaitingRoom(tracker.roomIdNumber, msg)
  }

  #notifyGameRoomWaiters(roomId: string) {
    this.#gameRoomConnectWaiters.notifyConnected(
      roomId,
      this.getConnectedGameRoomUserIds(roomId)
    )
  }

  getConnectedGameRoomUserIds(roomId: string): number[] {
    return this.#getUserIdsInGameRoom(roomId)
  }

  /**
   * 等待指定 userId 列表全部建立 /game namespace 连接（事件驱动）
   */
  waitForGameRoomUsersConnected(
    roomId: string,
    userIds: number[],
    options?: { timeoutMs?: number }
  ): Promise<void> {
    const timeoutMs =
      options?.timeoutMs ?? WAIT_FOR_GAME_USERS_CONNECTED_TIMEOUT_MS
    return this.#gameRoomConnectWaiters.waitForConnected(
      roomId,
      userIds,
      () => this.getConnectedGameRoomUserIds(roomId),
      timeoutMs
    )
  }
}

export default SocketServer
