import type { WsMessage } from '../ws/ws-event-types'

import { OnlineStatus } from 'texas-poker-core'
import { Server, Socket, Namespace } from 'socket.io'

import { server } from '../server'
import { logger } from '../logger'
import { RoomCleanupManager } from './roomCleanupManager'
import { GameEnteringTracker } from './gameEnteringTracker'
import { GameConnectionWaiterStore } from './gameConnectionWaiterStore'
import { gameRuntimeRegistry } from '../router/game/services/runtimeKit'

class SocketServer {
  #io: Server
  #gameNs: Namespace
  #roomListNs: Namespace
  #waitingRoomNs: Namespace
  #userIdToSocketIdMap: Map<number, string> = new Map()
  #gameRoomConnectWaiters = new GameConnectionWaiterStore()
  #gameEnteringTrackers = new GameEnteringTracker()
  #roomCleanupManager: RoomCleanupManager

  constructor() {
    this.#io = new Server(server, {
      cors: { origin: 'https://texas.wishufree.com' },
      // how many ms without a pong packet to consider the connection closed
      pingTimeout: 8000,
      // how many ms before sending a new ping packet
      pingInterval: 3000
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
        this.#getSocketsInWaitingRoom(roomId).length
    })

    this.#setupGameNamespace()
    this.#setupRoomListNamespace()
    this.#setupWaitingRoomNamespace()
  }

  get io() {
    return this.#io
  }

  /**
   * /game 命名空间：与德州扑克对局相关的 WS 连接
   * 约定：
   * - query.userId: number
   * - query.roomId: number（客户端房间 id，join 的房间名为 String(roomId)）
   */
  #setupGameNamespace() {
    this.#gameNs.use((socket, next) => {
      const query = socket.handshake.query
      const userId = Number(query.userId)
      const roomId = Number(query.roomId)
      if (!userId || !roomId || !Number.isFinite(roomId)) {
        logger.error(
          `[/game] websocket connect url:${socket.handshake.url}(parameters error), connection refused`
        )
        return next(
          new Error(
            'parameters to establish connection are invalid, connection refused'
          )
        )
      }
      next()
    })

    this.#gameNs.on('connection', (socket) => {
      logger.info('[/game] 新的客户端连接, url', socket.handshake.url)

      const query = socket.handshake.query
      const userId = Number(query.userId)
      const roomId = Number(query.roomId)
      const roomKey = String(roomId)

      socket.join(roomKey)
      socket.data.userId = userId
      socket.data.roomId = roomId

      // 一个 userId 只保留最后一次游戏连接
      this.#userIdToSocketIdMap.set(userId, socket.id)
      socket.send({ type: 'initial connect', data: null })

      this.#handleGameRoomConnect(roomKey, userId)
      this.#notifyGameRoomWaiters(roomKey)
      this.#notifyEnteringProgress(roomKey)

      const onLeave = () => {
        this.remove(roomKey, userId)
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
   * - query.userId: number
   * - 所有连接 join 同一个房间 'client-room-list'
   */
  #setupRoomListNamespace() {
    this.#roomListNs.use((socket, next) => {
      const query = socket.handshake.query
      const userId = Number(query.userId)
      if (!userId) {
        logger.error(
          `[/room-list] websocket connect url:${socket.handshake.url}(parameters error), connection refused`
        )
        return next(
          new Error(
            'parameters to establish connection are invalid, connection refused'
          )
        )
      }
      next()
    })

    this.#roomListNs.on('connection', (socket) => {
      logger.info('[/room-list] 新的客户端连接, url', socket.handshake.url)
      const query = socket.handshake.query
      const userId = Number(query.userId)

      socket.data.userId = userId
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
   * - query.userId: number
   * - query.roomId: number（客户端房间 id）
   * - 实际 join 的房间名即 String(roomId)
   */
  #setupWaitingRoomNamespace() {
    this.#waitingRoomNs.use((socket, next) => {
      const query = socket.handshake.query
      const userId = Number(query.userId)
      const roomId = Number(query.roomId)
      if (!userId || !roomId || !Number.isFinite(roomId)) {
        logger.error(
          `[/waiting-room] websocket connect url:${socket.handshake.url}(parameters error), connection refused`
        )
        return next(
          new Error(
            'parameters to establish connection are invalid, connection refused'
          )
        )
      }
      next()
    })

    this.#waitingRoomNs.on('connection', (socket) => {
      logger.info('[/waiting-room] 新的客户端连接, url', socket.handshake.url)
      const query = socket.handshake.query
      const userId = Number(query.userId)
      const roomId = Number(query.roomId)
      const roomKey = String(roomId)

      socket.data.userId = userId
      socket.data.roomId = roomId
      socket.join(roomKey)
      socket.send({ type: 'initial connect', data: null })

      socket.on('disconnect', (reason) => {
        logger.info(
          '[/waiting-room] client disconnect, id:',
          socket.id,
          'reason',
          reason
        )
        void this.#roomCleanupManager.tryCleanupWaitingRoomIfAllOffline(roomKey)
      })

      socket.on('error', (error) => {
        logger.error('[/waiting-room] WebSocket connect error:', error)
        void this.#roomCleanupManager.tryCleanupWaitingRoomIfAllOffline(roomKey)
      })
    })
  }

  #getSocketById(socketId: string) {
    return this.#io.sockets.sockets.get(socketId) as Socket | undefined
  }

  #getSocketsInWaitingRoom(roomId: string) {
    const socketIds = Array.from(
      this.#waitingRoomNs.adapter.rooms.get(roomId) || []
    )
    return socketIds
      .map((socketId) => this.#getSocketById(socketId))
      .filter((socket) => !!socket) as Socket[]
  }

  #getSocketsInGameRoom(roomId: string) {
    const socketIds = Array.from(this.#gameNs.adapter.rooms.get(roomId) || [])
    return socketIds
      .map((socketId) => this.#getSocketById(socketId))
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
      this.broadcast(channel, {
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
    this.broadcast(channel, {
      type: 'player-status-change',
      data: { user: { id: userId }, status: 'offline' as OnlineStatus }
    })
    const texas = gameRuntimeRegistry.getTexas(channel)
    const player = texas?.room.getPlayerById(userId)
    if (player) player.onlineStatus = 'offline'

    void this.#roomCleanupManager.tryCleanupRoomIfAllOffline(channel)
  }

  /**
   * @description 向所有端广播
   */
  broadcast(roomId: string, data: Parameters<Socket['send']>[0]) {
    logger.info(
      `broadcast, ${this.#getUserIdsInGameRoom(roomId)}, data: ${JSON.stringify(
        data
      )}`
    )
    this.#gameNs.to(roomId).emit('message', data)
  }

  /**
   * @description 向除了目标userId的所有端广播
   */
  broadcastExcept(
    roomId: string,
    userId: number,
    data: Parameters<Socket['send']>[0]
  ) {
    logger.info(
      `broadcastExcept, ${this.#getUserIdsInGameRoom(roomId).filter(
        (id) => id !== userId
      )}, data: ${JSON.stringify(data)}`
    )
    const sockets = this.#getSocketsInGameRoom(roomId)
    const except = sockets.find((socket) => socket.data.userId === userId)
    except?.to(roomId).emit('message', data)
  }

  /**
   * @description 向指定的端推送消息
   */
  broadcastTo(userId: number, data: Parameters<Socket['send']>[0]) {
    logger.info(`broadcastTo, ${userId}, data: ${JSON.stringify(data)}`)
    const socketId = this.#userIdToSocketIdMap.get(userId)
    if (!socketId) throw new Error('client does not exist')
    this.#io.to(socketId).emit('message', data)
  }

  /**
   * @description 自定义广播方式, 用于向所有端广播时, 每个端的数据有差异时
   */
  broadcastEach(
    roomId: string,
    callback: (userId: number) => Parameters<Socket['send']>[0]
  ) {
    logger.info(`broadcastEach, ${this.#getUserIdsInGameRoom(roomId)}`)
    this.#getSocketsInGameRoom(roomId).forEach((socket) => {
      const userId = socket.data.userId
      if (!userId) throw new Error('userId doest not exist on socket.data')
      this.#io.to(socket.id).emit('message', callback(userId))
    })
  }

  remove(roomId: string, userId: number) {
    const socketId = this.#userIdToSocketIdMap.get(userId)
    if (!socketId) return

    const socket = this.#getSocketById(socketId)
    socket?.leave(roomId)
    this.#userIdToSocketIdMap.delete(userId)
  }

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
   * 说明：waiting-room 连接不走 #userIdToSocketIdMap（该 map 仅用于 /game），
   * 因此这里通过 room 内在线 socket 反查并 leave(roomKey)。
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

    const connectedUserIds = this.getConnectedGameUserIds(roomKey).filter(
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
      this.getConnectedGameUserIds(roomId)
    )
  }

  getConnectedGameUserIds(roomId: string): number[] {
    return this.#getUserIdsInGameRoom(roomId)
  }

  /**
   * 等待指定 userId 列表全部建立 /game namespace 连接（事件驱动）
   */
  waitForGameUsersConnected(
    roomId: string,
    userIds: number[],
    options?: { timeoutMs?: number }
  ): Promise<void> {
    const timeoutMs = options?.timeoutMs ?? 15_000
    return this.#gameRoomConnectWaiters.waitForConnected(
      roomId,
      userIds,
      () => this.getConnectedGameUserIds(roomId),
      timeoutMs
    )
  }
}

export default SocketServer
