import { OnlineStatus } from 'texas-poker-core'
import { Server, Socket, Namespace } from 'socket.io'

import { server } from '../server'
import { logger } from '../logger'
import { rooms } from '../gameCenter'

class SocketServer {
  #io: Server
  #gameNs: Namespace
  #roomListNs: Namespace
  #waitingRoomNs: Namespace
  #userIdToSocketIdMap: Map<number, string> = new Map()

  constructor() {
    this.#io = new Server(server, {
      cors: { origin: 'https://texas.wishufree.com' },
      // TODO: may be pingTimeOut and pingInterval need to be set to a smaller one
      // how many ms without a pong packet to consider the connection closed
      pingTimeout: 8000,
      // how many ms before sending a new ping packet
      pingInterval: 3000
      // cors: { origin: '*' }
    })

    /**
     * 命名空间：
     * - /game        ：游戏进程 WS，使用 gameCenter.rooms 的 roomId 作为房间名
     * - /room-list   ：房间列表 WS，所有连接 join 'client-room-list'
     * - /waiting-room：等待房间/客户端房间 WS，join 房间名为 roomId
     */
    this.#gameNs = this.#io.of('/game')
    this.#roomListNs = this.#io.of('/room-list')
    this.#waitingRoomNs = this.#io.of('/waiting-room')

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
   * - query.roomId: string（gameCenter.rooms 的 key）
   */
  #setupGameNamespace() {
    this.#gameNs.use((socket, next) => {
      const query = socket.handshake.query
      const userId = Number(query.userId)
      const roomId = query.roomId as string
      if (!userId || !roomId) {
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
      const roomId = query.roomId as string

      socket.join(roomId)
      socket.data.userId = userId
      socket.data.roomId = roomId

      // 一个 userId 只保留最后一次游戏连接
      this.#userIdToSocketIdMap.set(userId, socket.id)
      socket.send({ type: 'initial connect', data: null })

      this.#handleGameRoomConnect(roomId, userId)

      socket.on('disconnect', (reason) => {
        this.remove(roomId, userId)
        this.#handleGameRoomDisconnect(roomId, userId)
        logger.info(
          '[/game] client disconnect, id:',
          socket.id,
          'reason',
          reason
        )
      })

      socket.on('error', (error) => {
        this.remove(roomId, userId)
        this.#handleGameRoomDisconnect(roomId, userId)
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
   * - query.roomId: string | number（客户端房间 id）
   * - 实际 join 的房间名即 roomId（字符串）
   */
  #setupWaitingRoomNamespace() {
    this.#waitingRoomNs.use((socket, next) => {
      const query = socket.handshake.query
      const userId = Number(query.userId)
      const roomId = query.roomId as string
      if (!userId || !roomId) {
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
      const roomId = String(query.roomId)

      socket.data.userId = userId
      socket.data.roomId = roomId
      socket.join(roomId)
      socket.send({ type: 'initial connect', data: null })

      socket.on('disconnect', (reason) => {
        logger.info(
          '[/waiting-room] client disconnect, id:',
          socket.id,
          'reason',
          reason
        )
      })

      socket.on('error', (error) => {
        logger.error('[/waiting-room] WebSocket connect error:', error)
      })
    })
  }

  /**
   * 仅当 channel 为游戏房间（gameCenter 中存在）时：标记玩家在线并广播
   */
  #handleGameRoomConnect(channel: string, userId: number) {
    const texas = rooms.get(channel)
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
   * 仅当 channel 为游戏房间时：广播玩家离线并更新 Texas 内状态
   */
  #handleGameRoomDisconnect(channel: string, userId: number) {
    if (!rooms.has(channel)) return
    this.broadcast(channel, {
      type: 'player-status-change',
      data: { user: { id: userId }, status: 'offline' as OnlineStatus }
    })
    const texas = rooms.get(channel)
    const player = texas?.room.getPlayerById(userId)
    if (player) player.onlineStatus = 'offline'
  }

  /**
   * @description 通过socketId获取对应的socket实例
   * @param socketId
   * @returns
   */
  #getSocketById(socketId: string) {
    return this.#io.sockets.sockets.get(socketId) as Socket | undefined
  }

  /**
   * @description 获取房间内的所有socket实例
   * @param roomId
   * @returns
   */
  #getSocketsInRoom(roomId: string) {
    const socketIds = Array.from(this.#gameNs.adapter.rooms.get(roomId) || [])
    return socketIds
      .map((socketId) => this.#getSocketById(socketId))
      .filter((socket) => !!socket) as Socket[]
  }

  /**
   * @description 获取指定room下的所有用户id
   * @param roomId
   * @returns
   */
  #getUserIdsInRoom(roomId: string) {
    return this.#getSocketsInRoom(roomId)
      .map((socket) => socket?.data.userId as number)
      .filter((userId) => !!userId) as number[]
  }

  /**
   * @description 向所有端广播
   */
  broadcast(roomId: string, data: Parameters<Socket['send']>[0]) {
    logger.info(
      `broadcast, ${this.#getUserIdsInRoom(roomId)}, data: ${JSON.stringify(
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
      `broadcastExcept, ${this.#getUserIdsInRoom(roomId).filter(
        (id) => id !== userId
      )}, data: ${JSON.stringify(data)}`
    )
    const sockets = this.#getSocketsInRoom(roomId)
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
    logger.info(`broadcastEach, ${this.#getUserIdsInRoom(roomId)}`)

    this.#getSocketsInRoom(roomId).forEach((socket) => {
      const userId = socket.data.userId
      if (!userId) throw new Error('userId doest not exist on socket.data')

      this.#io.to(socket.id).emit('message', callback(userId))
    })
  }

  /**
   * @description 移除ws客户端
   */
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
}

export default SocketServer
