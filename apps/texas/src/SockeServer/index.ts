import { Server, Socket } from 'socket.io'
import { OnlineStatus } from 'texas-poker-core'

import { server } from '../server'
import { logger } from '../logger'
import { rooms } from '../gameCenter'

class SocketServer {
  #io: Server
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

    // socket.io 中间件：校验 userId 与 channel（订阅的频道名）
    // channel 示例：client-room:123（某房间）、client-room-list（房间列表）
    this.#io.use((socket, next) => {
      const queryParams = socket.handshake.query
      const userId = Number(queryParams.userId)
      const channel =
        (queryParams.channel as string) ?? (queryParams.roomId as string)
      if (!userId || !channel) {
        logger.error(
          `websocket connect url:${socket.handshake.url}(parameters error), connection refused`
        )
        return next(
          new Error(
            'parameters to establish connection are invalid, connection refused'
          )
        )
      }
      next()
    })

    this.#io.on('connection', (socket) => {
      logger.info('新的客户端连接, url', socket.handshake.url)

      const queryParams = socket.handshake.query
      const userId = Number(queryParams.userId)
      const channel =
        (queryParams.channel as string) ?? (queryParams.roomId as string)

      socket.join(channel)
      socket.data.userId = userId
      socket.data.channel = channel

      this.#userIdToSocketIdMap.set(userId, socket.id)
      socket.send({ type: 'initial connect', data: null })

      // 仅当 channel 对应游戏进程时：维护 Texas 玩家在线状态并广播
      // （client-room:* / client-room-list 等不会进入此分支）
      this.#handleGameRoomConnect(channel, userId)

      socket.on('disconnect', (reason) => {
        this.remove(channel, userId)
        this.#handleGameRoomDisconnect(channel, userId)
        logger.info('client disconnect, id:', socket.id, 'reason', reason)
      })

      socket.on('error', (error) => {
        this.remove(channel, userId)
        this.#handleGameRoomDisconnect(channel, userId)
        logger.error('WebSocket connect error:', error)
      })
    })
  }

  get io() {
    return this.#io
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
    const socketIds = Array.from(
      this.#io.sockets.adapter.rooms.get(roomId) || []
    )
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
    this.#io.to(roomId).emit('message', data)
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
}

export default SocketServer
