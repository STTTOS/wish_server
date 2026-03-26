import type { WsMessage } from '../ws/ws-event-types'

import { OnlineStatus } from 'texas-poker-core'
import { Server, Socket, Namespace } from 'socket.io'

import { server } from '../server'
import { logger } from '../logger'
import { room as roomModel } from '../models'
import { getGame, hasGame, destroyGame } from '../gameCenter'
import {
  cancelNextHandCountdown,
  unregisterNextHandHooks
} from '../gameCenter/nextHandCountdown'

class SocketServer {
  #io: Server
  #gameNs: Namespace
  #roomListNs: Namespace
  #waitingRoomNs: Namespace
  #userIdToSocketIdMap: Map<number, string> = new Map()
  #gameRoomConnectWaiters: Map<
    string,
    Array<{
      expected: Set<number>
      resolve: () => void
      reject: (err: Error) => void
      timeout: NodeJS.Timeout
    }>
  > = new Map()

  #gameEnteringTrackers: Map<
    string,
    {
      roomIdNumber: number
      expected: Set<number>
    }
  > = new Map()

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
        void this.#tryCleanupWaitingRoomIfAllOffline(roomKey)
      })

      socket.on('error', (error) => {
        logger.error('[/waiting-room] WebSocket connect error:', error)
        void this.#tryCleanupWaitingRoomIfAllOffline(roomKey)
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

  async #tryCleanupWaitingRoomIfAllOffline(roomId: string) {
    // waiting-room 的 roomId 是客户端房间 id（数字字符串）
    const roomIdNumber = Number(roomId)
    if (!roomIdNumber) return

    // 还有连接在 waiting-room，说明仍有人在线
    const sockets = this.#getSocketsInWaitingRoom(roomId)
    if (sockets.length > 0) return

    // 仅当房间处于 waiting（大厅等待）状态时才允许自动清理：
    // - entering / between_hands / in_hand：即使 waiting-room 无人在线，也不应删除（客户端会转到 /game）
    const info = await roomModel.findUnique({
      where: { id: roomIdNumber },
      select: { deletedAt: true, gameStatus: true }
    })
    if (!info || info.deletedAt) return
    if (info.gameStatus !== 'waiting') return

    // 若已经有游戏实例，则由 /game 的清理逻辑负责
    if (hasGame(roomId)) return

    try {
      await roomModel.update({
        where: { id: roomIdNumber },
        data: { deletedAt: new Date() }
      })
      logger.info(
        `[waiting-room-cleanup] all offline, soft-deleted room ${roomIdNumber}`
      )
    } catch (e) {
      // 房间可能已被删除/不存在，忽略即可
      logger.error('[waiting-room-cleanup] failed', e)
    }
  }

  /**
   * 仅当 channel 为游戏房间（gameCenter 中存在）时：标记玩家在线并广播
   */
  #handleGameRoomConnect(channel: string, userId: number) {
    const texas = getGame(channel)
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
    if (!hasGame(channel)) return
    this.broadcast(channel, {
      type: 'player-status-change',
      data: { user: { id: userId }, status: 'offline' as OnlineStatus }
    })
    const texas = getGame(channel)
    const player = texas?.room.getPlayerById(userId)
    if (player) player.onlineStatus = 'offline'

    void this.#tryCleanupRoomIfAllOffline(channel)
  }

  async #tryCleanupRoomIfAllOffline(roomId: string) {
    const texas = getGame(roomId)
    if (!texas) return

    const players = texas.room.getAllPlayers()
    if (players.length === 0) {
      const roomIdNumber = Number(roomId)
      if (roomIdNumber) {
        try {
          cancelNextHandCountdown(roomIdNumber)
          unregisterNextHandHooks(roomIdNumber)
        } catch {
          // ignore
        }
      }
      destroyGame(roomId)
      // 游戏实例已清除后，顺手尝试清理 waiting-room（受 gameStatus 限制，不会误删 entering/in_game）
      await this.#tryCleanupWaitingRoomIfAllOffline(roomId)
      return
    }

    const allOffline = players.every((p) => p.onlineStatus === 'offline')
    if (!allOffline) return

    // 所有人都离线：清理内存对局实例（含下一手倒计时相关状态）
    const roomIdNumber = Number(roomId)
    if (roomIdNumber) {
      try {
        cancelNextHandCountdown(roomIdNumber)
        unregisterNextHandHooks(roomIdNumber)
      } catch {
        // ignore
      }
    }
    destroyGame(roomId)
    logger.info(`[room-cleanup] all offline, removed room ${roomId}`)

    // 清除游戏后，若房间处于 waiting 且 waiting-room 也无人在线，则软删房间记录
    await this.#tryCleanupWaitingRoomIfAllOffline(roomId)
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

  trackGameEntering(roomIdNumber: number, expectedUserIds: number[]) {
    const roomKey = String(roomIdNumber)
    this.#gameEnteringTrackers.set(roomKey, {
      roomIdNumber,
      expected: new Set(expectedUserIds)
    })
    this.#notifyEnteringProgress(roomKey)
  }

  untrackGameEntering(roomIdNumber: number) {
    const roomKey = String(roomIdNumber)
    this.#gameEnteringTrackers.delete(roomKey)
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
    const waiters = this.#gameRoomConnectWaiters.get(roomId)
    if (!waiters || waiters.length === 0) return

    const connected = new Set(this.getConnectedGameUserIds(roomId))
    const readyWaiters = waiters.filter((w) =>
      Array.from(w.expected).every((id) => connected.has(id))
    )
    if (readyWaiters.length === 0) return

    readyWaiters.forEach((w) => {
      clearTimeout(w.timeout)
      w.resolve()
    })

    const remaining = waiters.filter((w) => !readyWaiters.includes(w))
    if (remaining.length === 0) this.#gameRoomConnectWaiters.delete(roomId)
    else this.#gameRoomConnectWaiters.set(roomId, remaining)
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
    const expected = new Set(userIds)

    // 先做一次同步检查，避免“都已连接但还在等”的竞态
    const connected = new Set(this.getConnectedGameUserIds(roomId))
    const allReady = Array.from(expected).every((id) => connected.has(id))
    if (allReady) return Promise.resolve()

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        // 从等待队列移除自己
        const list = this.#gameRoomConnectWaiters.get(roomId) ?? []
        this.#gameRoomConnectWaiters.set(
          roomId,
          list.filter((w) => w.resolve !== resolve)
        )
        const latestConnected = this.getConnectedGameUserIds(roomId)
        reject(
          new Error(
            `waitForGameUsersConnected timeout, roomId=${roomId}, expected=${JSON.stringify(
              userIds
            )}, connected=${JSON.stringify(latestConnected)}`
          )
        )
      }, timeoutMs)

      const waiter = { expected, resolve, reject, timeout }
      const list = this.#gameRoomConnectWaiters.get(roomId) ?? []
      list.push(waiter)
      this.#gameRoomConnectWaiters.set(roomId, list)
    })
  }
}

export default SocketServer
