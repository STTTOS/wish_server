import { Server, Socket } from 'socket.io'

import { server } from '../server'
import { logger } from '../logger'

class SocketServer {
  #io: Server
  #clients: Map<number, Socket> = new Map()

  constructor() {
    this.#io = new Server(server, {
      cors: { origin: 'https://texas.wishufree.com' }
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
        logger.error(`ws连接url:${socket.handshake.url}(参数异常), 拒绝连接`)
        return next(new Error('无效的连接参数, 拒绝连接'))
      }

      // 允许连接
      next()
    })

    // 只有当玩家加入房间时, 才开启ws连接
    // 退出房间时, 需要关闭连接
    this.#io.on('connection', (socket) => {
      logger.info('新的客户端连接, url', socket.handshake.url)

      const queryParams = socket.handshake.query
      const [userId] = [
        Number(queryParams.userId),
        queryParams.roomId as string
      ]

      // 将用户ID与连接关联
      this.#clients.set(userId, socket)
      socket.send({ type: 'initial connect', data: null })
      // 向客户端发送欢迎消息
      // ws.readyState === WebSocket.OPEN

      // 处理连接关闭
      socket.on('disconnect', (reason) => {
        // 玩家离开房间, 玩家离线等
        // 需要向其他客户端推送消息
        this.#clients.delete(userId)
        logger.info('客户端断开连接, id:', socket.id, '原因', reason)
      })

      // 处理错误
      socket.on('error', (error) => {
        // 连接出现异常, 则无法正常加入房间
        this.#clients.delete(userId)
        logger.error('WebSocket 错误:', error)
      })
    })
  }

  get io() {
    return this.#io
  }

  get clients() {
    return this.#clients
  }

  get userIds() {
    return [...this.#clients.keys()]
  }
  /**
   * @description 向所有端广播
   */
  broadcast(data: Parameters<Socket['send']>[0]) {
    logger.info(`broadcast, ${this.userIds}, data: ${JSON.stringify(data)}`)
    this.#clients.forEach((client) => {
      client.send(data)
    })
  }
  /**
   * @description 向除了目标userId的所有端广播
   */
  broadcastExcept(userId: number, data: Parameters<Socket['send']>[0]) {
    logger.info(
      `broadcastExcept, ${this.userIds.filter(
        (id) => id !== userId
      )}, data: ${JSON.stringify(data)}`
    )
    this.#clients.forEach((client, id) => {
      if (id !== userId) {
        client.send(data)
      }
    })
  }
  /**
   * @description 向指定的端推送消息
   */
  broadcastTo(userId: number, data: Parameters<Socket['send']>[0]) {
    logger.info(`broadcastTo, ${userId}, data: ${JSON.stringify(data)}`)
    this.#clients.get(userId)?.send(data)
  }

  /**
   * @description 自定义广播方式, 用于向所有端广播时, 每个端的数据有差异时
   */
  broadcastEach(callback: (userId: number) => Parameters<Socket['send']>[0]) {
    logger.info(`broadcastEach, ${this.userIds}`)
    this.#clients.forEach((client, id) => {
      client.send(callback(id))
    })
  }

  /**
   * @description 移除ws客户端
   */
  remove(userId: number) {
    this.#clients.delete(userId)
  }
}

export default SocketServer
