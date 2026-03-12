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

    // socket.io中间件
    // 检查userId与roomId参数是否传递
    // 否则不予链接
    this.#io.use((socket, next) => {
      const queryParams = socket.handshake.query
      const [userId, roomId] = [
        Number(queryParams.userId),
        queryParams.roomId as string
      ]
      // 验证参数
      if (!userId || !roomId) {
        // 传递错误，拒绝连接
        logger.error(
          `websocket conentct url:${socket.handshake.url}(parameters error), connection refused`
        )
        return next(
          new Error(
            'parameters to establish connection are invalid, connection refused'
          )
        )
      }

      // 允许连接
      next()
    })

    // 只有当玩家加入房间时, 才开启ws连接
    // 退出房间时, 需要关闭连接
    this.#io.on('connection', (socket) => {
      logger.info('新的客户端连接, url', socket.handshake.url)

      const queryParams = socket.handshake.query
      const [userId, roomId] = [
        Number(queryParams.userId),
        queryParams.roomId as string
      ]

      socket.join(roomId)
      // store userId on socket.data
      socket.data.userId = userId

      // map userId to socketId
      this.#userIdToSocketIdMap.set(userId, socket.id)
      socket.send({ type: 'initial connect', data: null })

      // 玩家重连或首次连接到房间, 标记为 online 并通知其他客户端
      const texasOnConnect = rooms.get(roomId)
      const playerOnConnect = texasOnConnect?.room.getPlayerById(userId)
      // 只有当玩家之前被标记为离线时(重连), 才更新为在线并广播
      if (playerOnConnect && playerOnConnect.onlineStatus !== 'online') {
        playerOnConnect.onlineStatus = 'online'
        this.broadcast(roomId, {
          type: 'player-status-change',
          data: { user: { id: userId }, status: 'online' as OnlineStatus }
        })
      }

      // 处理连接关闭
      socket.on('disconnect', (reason) => {
        // 玩家离开房间, 玩家离线等
        // 需要向其他客户端推送消息
        this.remove(roomId, userId)
        this.broadcast(roomId, {
          type: 'player-status-change',
          data: { user: { id: userId }, status: 'offline' as OnlineStatus }
        })
        const texas = rooms.get(roomId)
        const player = texas?.room.getPlayerById(userId)
        if (player) player.onlineStatus = 'offline'

        logger.info('client disconnect, id:', socket.id, 'reason', reason)
      })

      // 处理错误
      socket.on('error', (error) => {
        // 连接出现异常, 则无法正常加入房间
        this.remove(roomId, userId)
        logger.error('WebSocket connect error:', error)
      })
    })
  }

  get io() {
    return this.#io
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
