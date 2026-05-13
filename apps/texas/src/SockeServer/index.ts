import type {
  WsMessage,
  RoomWsMessage,
  WsWaitingRoomPresenceSnapshotData
} from '@wishufree/texas-ws-contract'

import { Server, Socket, Namespace } from 'socket.io'

import { server } from '../server'
import { logger } from '../logger'
import { isAdminUser } from '../utils/isAdminUser'
import prisma, { room as roomModel } from '../models'
import { RoomCleanupManager } from './roomCleanupManager'
import { GameEnteringTracker } from './gameEnteringTracker'
import { isMaintenanceEnabled } from '../utils/maintenanceSwitch'
import { GameConnectionWaiterStore } from './gameConnectionWaiterStore'
import { gameRuntimeRegistry } from '../router/game/services/runtimeRegistry'
import { setNextHandCountdownBroadcaster } from '../gameRuntime/nextHandCountdown'
import {
  MAINTENANCE_CODE,
  MAINTENANCE_MESSAGE
} from '../router/system/maintenanceConstants'
import {
  SOCKET_IO_PING_TIMEOUT_MS,
  SOCKET_IO_PING_INTERVAL_MS,
  WAIT_FOR_GAME_USERS_CONNECTED_TIMEOUT_MS
} from '../constants/ws'
import {
  replayGameRoomSince,
  getLatestGameRoomSeq,
  getGameRoomReplayEpoch,
  recordGameRoomBroadcast
} from './gameRoomWsReplayBuffer'
import {
  resolveWsUserFromHandshake,
  getWsRoomIdFromHandshakeAuth,
  getWsGameRoomSinceSeqFromHandshake,
  getWsGameRoomReplayEpochFromHandshake
} from '../utils/wsAuth'

const WAITING_ROOM_PRESENCE_OFFLINE_GRACE_MS = 3000

class SocketServer {
  #io: Server
  #gameNs: Namespace
  #roomListNs: Namespace
  #waitingRoomNs: Namespace
  #gameRoomConnectWaiters = new GameConnectionWaiterStore()
  /** entering 阶段：等全员在 `/waiting-room` 在线（客户端进 `/match` 后再建 `/game`） */
  #waitingRoomEnteringWaiters = new GameConnectionWaiterStore()
  #gameEnteringTrackers = new GameEnteringTracker()
  #roomCleanupManager: RoomCleanupManager
  #waitingRoomPresenceOfflineAnnounced = new Set<string>()
  #waitingRoomPendingUsers = new Set<string>()
  #waitingRoomPendingOfflineTimers = new Map<
    string,
    ReturnType<typeof setTimeout>
  >()
  #waitingRoomPresenceSeqByRoom = new Map<string, number>()

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

      /**
       * 全房广播补发（`game-room-replay`），与 {@link gameRoomWsReplayBuffer} 对齐：
       *
       * - **`sinceSeq`**（握手 `auth.gameRoomSinceSeq`）：客户端声称「**序号 ≤ sinceSeq 的全房广播我已处理过**」；
       *   服务端只回放 **`seq > sinceSeq`**。`0` 表示未带游标 / 从头跟实时流。
       * - **`latestSeq`**（`getLatestGameRoomSeq`）：本房缓冲已分配到的**最大序号**（全房广播条数的水位线）；
       *   未必等于 `ring` 内最老条的 `seq`（旧条目可能被环形挤出）。
       * - **`entries`**：`replayGameRoomSince` 返回的、仍留在环形缓冲里的 **`seq > sinceSeq`** 的记录。
       * - **`truncated`**：客户端自认落后（`sinceSeq < latestSeq`）但 **`entries` 为空**——说明
       *   `(sinceSeq, latestSeq]` 区间内的消息**已不在缓冲**（断线过久或进程重启等），**不能只靠 WS 补**，须 HTTP 快照对齐。
       * - **`afterSeq`**：与 `sinceSeq` 同值写入 payload，语义为「本包补发下界（不含）」。
       * - **`throughSeq`**：本包 `events` 中**最大 `seq`**；若 `events` 为空（仅 `truncated` 场景）则退化为 `sinceSeq`，表示本包未通过缓冲补到任何一条。
       */
      const sinceSeq = getWsGameRoomSinceSeqFromHandshake(socket.handshake)
      if (sinceSeq >= 0) {
        const replayEpoch = getGameRoomReplayEpoch()
        const clientReplayEpoch = getWsGameRoomReplayEpochFromHandshake(
          socket.handshake
        )
        const latestSeq = getLatestGameRoomSeq(roomKey)
        const entries = replayGameRoomSince(roomKey, sinceSeq)
        const epochMismatch =
          clientReplayEpoch != null && clientReplayEpoch !== replayEpoch
        const truncated =
          epochMismatch ||
          (sinceSeq > 0 && sinceSeq < latestSeq && entries.length === 0)
        if (entries.length > 0 || truncated) {
          const throughSeq =
            entries.length > 0 ? entries[entries.length - 1]!.seq : sinceSeq
          const replay: WsMessage<'game-room-replay'> = {
            type: 'game-room-replay',
            data: {
              roomId,
              afterSeq: sinceSeq,
              throughSeq,
              latestSeq,
              replayEpoch,
              ...(truncated ? { truncated: true as const } : {}),
              events: entries.map((e) => ({
                seq: e.seq,
                payload: e.payload as Record<string, unknown>
              }))
            }
          }
          socket.emit('message', replay)
        }
      }

      this.#handleGameRoomConnect(roomKey, userId)
      this.#notifyGameRoomWaiters(roomKey)
      this.#notifyEnteringProgress(roomKey)

      const onLeave = () => {
        this.#handleGameRoomDisconnect(roomKey, userId, socket.id)
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
      this.#notifyWaitingRoomEnteringWaiters(roomKey)
      /** 补发：HTTP 已 join 但 WS 连晚于 `game-entering` 广播时，避免卡在等待页 */
      void this.#replayMissedEnteringIfNeeded(socket, roomId)

      const userId = socket.data.userId as number
      if (typeof userId === 'number') {
        const presenceKey = this.#waitingRoomPresenceKey(roomKey, userId)
        const shouldAnnounceOnline =
          this.#waitingRoomPresenceOfflineAnnounced.has(presenceKey) ||
          this.#waitingRoomPendingUsers.has(presenceKey)
        if (shouldAnnounceOnline) {
          this.#clearWaitingRoomPendingState(presenceKey)
          const didBroadcast = this.#broadcastWaitingRoomPresence(
            roomKey,
            roomId,
            userId,
            socket.id,
            'online'
          )
          if (didBroadcast) {
            this.#waitingRoomPresenceOfflineAnnounced.delete(presenceKey)
          }
        }
      }
      void this.#emitWaitingRoomPresenceSnapshot(socket, roomId)

      socket.on('disconnect', (reason) => {
        logger.info(
          '[/waiting-room] client disconnect, id:',
          socket.id,
          'reason',
          reason
        )
        void this.#onWaitingRoomSocketDropped(socket, roomKey, roomId)
      })

      socket.on('error', (error) => {
        logger.error('[/waiting-room] WebSocket connect error:', error)
        void this.#onWaitingRoomSocketDropped(socket, roomKey, roomId)
      })
    })
  }

  /**
   * 连接 `/waiting-room` 时若房间已在 `entering`，向本 socket 单独补发一条 `game-entering`
   *（与 {@link GameWsGateway.notifyEntering} 同形），与广播时序解耦。
   */
  async #replayMissedEnteringIfNeeded(socket: Socket, roomId: number) {
    try {
      const row = await roomModel.findUnique({
        where: { id: roomId },
        select: { gameStatus: true, deletedAt: true }
      })
      if (!row || row.deletedAt != null) return
      if (row.gameStatus !== 'entering') return
      const msg: WsMessage<'game-entering'> = {
        type: 'game-entering',
        data: { roomId }
      }
      socket.emit('message', msg)
      logger.info(
        `[waiting-room] replay game-entering, roomId=${roomId}, socketId=${socket.id}`
      )
    } catch (e) {
      logger.error('[waiting-room] replay game-entering failed', e)
    }
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

  #waitingRoomPresenceKey(roomKey: string, userId: number) {
    return `${roomKey}:${userId}`
  }

  #nextWaitingRoomPresenceSeq(roomKey: string) {
    const next = (this.#waitingRoomPresenceSeqByRoom.get(roomKey) ?? 0) + 1
    this.#waitingRoomPresenceSeqByRoom.set(roomKey, next)
    return next
  }

  #clearWaitingRoomPendingTimer(presenceKey: string) {
    const timer = this.#waitingRoomPendingOfflineTimers.get(presenceKey)
    if (!timer) return
    clearTimeout(timer)
    this.#waitingRoomPendingOfflineTimers.delete(presenceKey)
  }

  #clearWaitingRoomPendingState(presenceKey: string) {
    this.#clearWaitingRoomPendingTimer(presenceKey)
    this.#waitingRoomPendingUsers.delete(presenceKey)
  }

  #isWaitingRoomUserConnected(roomKey: string, userId: number) {
    return this.#getSocketsInWaitingRoom(roomKey).some(
      (s) => (s.data.userId as number) === userId
    )
  }

  #scheduleFinalizeWaitingRoomOffline(
    roomKey: string,
    roomId: number,
    userId: number
  ) {
    const presenceKey = this.#waitingRoomPresenceKey(roomKey, userId)
    this.#clearWaitingRoomPendingTimer(presenceKey)
    const timer = setTimeout(() => {
      void this.#finalizeWaitingRoomOffline(roomKey, roomId, userId)
    }, WAITING_ROOM_PRESENCE_OFFLINE_GRACE_MS)
    this.#waitingRoomPendingOfflineTimers.set(presenceKey, timer)
  }

  async #finalizeWaitingRoomOffline(
    roomKey: string,
    roomId: number,
    userId: number
  ) {
    const presenceKey = this.#waitingRoomPresenceKey(roomKey, userId)
    this.#waitingRoomPendingOfflineTimers.delete(presenceKey)
    try {
      const member = await prisma.roomMember.findUnique({
        where: { roomId_userId: { roomId, userId } },
        select: { userId: true }
      })
      if (member == null || this.#isWaitingRoomUserConnected(roomKey, userId)) {
        this.#clearWaitingRoomPendingState(presenceKey)
        return
      }
      this.#waitingRoomPendingUsers.delete(presenceKey)
      const didBroadcast = this.#broadcastWaitingRoomPresence(
        roomKey,
        roomId,
        userId,
        '',
        'offline'
      )
      if (didBroadcast) {
        this.#waitingRoomPresenceOfflineAnnounced.add(presenceKey)
      }
    } catch (e) {
      logger.error(
        `[waiting-room] finalize offline failed roomId=${roomId} userId=${userId}`,
        e
      )
      this.#clearWaitingRoomPendingState(presenceKey)
    }
  }

  async #emitWaitingRoomPresenceSnapshot(socket: Socket, roomId: number) {
    const roomKey = String(roomId)
    try {
      const members = await prisma.roomMember.findMany({
        where: { roomId },
        select: { userId: true }
      })
      const onlineIds = this.getWaitingRoomOnlineUserIds(roomId)
      const payload: WsWaitingRoomPresenceSnapshotData = {
        roomId,
        seq: this.#waitingRoomPresenceSeqByRoom.get(roomKey) ?? 0,
        members: members.map(({ userId }) => {
          const online = onlineIds.has(userId)
          const pending =
            !online &&
            this.#waitingRoomPendingUsers.has(
              this.#waitingRoomPresenceKey(roomKey, userId)
            )
          let state: 'online' | 'offline' | 'pending' = 'offline'
          if (online) state = 'online'
          else if (pending) state = 'pending'
          return { userId, state }
        })
      }
      const msg: RoomWsMessage<'waiting-room-presence-snapshot'> = {
        type: 'waiting-room-presence-snapshot',
        data: payload
      }
      socket.emit('message', msg)
    } catch (e) {
      logger.error(
        `[waiting-room] emit presence snapshot failed roomId=${roomId}, socketId=${socket.id}`,
        e
      )
    }
  }

  /**
   * 多终端时：仅当该用户在房间内已无其它 waiting-room 连接时广播，避免误报掉线/上线。
   */
  #broadcastWaitingRoomPresence(
    roomKey: string,
    roomIdNumber: number,
    userId: number,
    socketId: string,
    state: 'online' | 'offline' | 'pending'
  ): boolean {
    const peers = this.#getSocketsInWaitingRoom(roomKey).filter(
      (s) => (s.data.userId as number) === userId && s.id !== socketId
    )
    if (peers.length > 0) return false
    const seq = this.#nextWaitingRoomPresenceSeq(roomKey)
    const msg: RoomWsMessage<'waiting-room-member-presence'> = {
      type: 'waiting-room-member-presence',
      data: { userId, state, seq }
    }
    this.broadcastWaitingRoom(roomIdNumber, msg)
    return true
  }

  async #onWaitingRoomSocketDropped(
    socket: Socket,
    roomKey: string,
    roomIdNumber: number
  ) {
    const userId = socket.data.userId as number
    if (typeof userId === 'number') {
      /**
       * HTTP 退出/踢人已广播 `waiting-room-member-left` 并删 `RoomMember`；
       * 随后客户端断开 waiting-room 仍会走本路径，不应再发 `waiting-room-member-presence` offline（语义重复）。
       */
      try {
        const member = await prisma.roomMember.findUnique({
          where: {
            roomId_userId: { roomId: roomIdNumber, userId }
          },
          select: { userId: true }
        })
        if (member != null) {
          const presenceKey = this.#waitingRoomPresenceKey(roomKey, userId)
          const didBroadcast = this.#broadcastWaitingRoomPresence(
            roomKey,
            roomIdNumber,
            userId,
            socket.id,
            'pending'
          )
          if (didBroadcast) {
            this.#waitingRoomPendingUsers.add(presenceKey)
            this.#scheduleFinalizeWaitingRoomOffline(
              roomKey,
              roomIdNumber,
              userId
            )
          }
        }
      } catch (e) {
        logger.error(
          `[waiting-room] member lookup before presence broadcast failed roomId=${roomIdNumber} userId=${userId}`,
          e
        )
        const presenceKey = this.#waitingRoomPresenceKey(roomKey, userId)
        const didBroadcast = this.#broadcastWaitingRoomPresence(
          roomKey,
          roomIdNumber,
          userId,
          socket.id,
          'pending'
        )
        if (didBroadcast) {
          this.#waitingRoomPendingUsers.add(presenceKey)
          this.#scheduleFinalizeWaitingRoomOffline(
            roomKey,
            roomIdNumber,
            userId
          )
        }
      }
    }
    void this.#roomCleanupManager.tryCleanupWaitingRoomIfAllOffline(roomKey)
    this.#notifyWaitingRoomEnteringWaiters(roomKey)
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

  /** 同一用户在本房是否仍有其它 /game 连接（用于重连重叠时避免误报离线）。 */
  #countPeerGameSockets(
    roomId: string,
    userId: number,
    excludeSocketId: string
  ): number {
    return this.#getSocketsInGameRoom(roomId).filter(
      (s) => (s.data.userId as number) === userId && s.id !== excludeSocketId
    ).length
  }

  /**
   * 在座且本房仍有该用户的 /game 连接时：写入在线态，并在刚从离线恢复时补发 `online`。
   * `connection` 与「hang → on-set」后的补同步共用（见 {@link resyncGameRoomSeatPresence}）。
   */
  #applyGameRoomOnSeatPresenceIfConnected(channel: string, userId: number) {
    const texas = gameRuntimeRegistry.getTexas(channel)
    if (!texas) return
    const player = texas.room.getPlayerById(userId)
    if (!player) return
    const isOnSeat = texas.room.getPlayerSeatStatusById(userId) === 'on-set'
    if (!isOnSeat) {
      gameRuntimeRegistry.clearConnectionTracking(channel, userId)
      return
    }
    const hasLiveSocket = this.#getSocketsInGameRoom(channel).some(
      (s) => (s.data.userId as number) === userId
    )
    if (!hasLiveSocket) return
    const wasOffline = gameRuntimeRegistry.isUserOffline(channel, userId)
    gameRuntimeRegistry.markUserOnline(channel, userId)
    if (!wasOffline) return
    this.broadcastGameRoom(
      channel,
      {
        type: 'player-status-change',
        data: { roomId: Number(channel), userId, status: 'online' as const }
      },
      { skipReplay: true }
    )
  }

  /**
   * 领域已将玩家标为 `on-set` 后调用：补跑与 `/game` `connection` 等价的在线同步。
   * 解决「先连上时仍为 hang，随后入座未再触发 connection」时误将后续断线当成首断并播报离线。
   */
  resyncGameRoomSeatPresence(roomKey: string, userIds: number[]) {
    const seen = new Set<number>()
    for (const userId of userIds) {
      if (!Number.isFinite(userId) || userId <= 0 || seen.has(userId)) continue
      seen.add(userId)
      this.#applyGameRoomOnSeatPresenceIfConnected(roomKey, userId)
    }
  }

  /**
   * 仅当 channel 为游戏房间（runtimeRegistry 中存在）且为在座玩家时：标记在线并广播
   * 设计约束：
   * - 只处理 `on-set` 玩家，观战的连断不影响当局离线托管逻辑。
   * - 先写 runtime 状态，再决定是否推送 `player-status-change`（去重）。
   */
  #handleGameRoomConnect(channel: string, userId: number) {
    this.#applyGameRoomOnSeatPresenceIfConnected(channel, userId)
  }

  /**
   * 仅当 channel 为游戏房间（runtimeRegistry 中存在）且为在座玩家时：广播玩家离线
   *（排除已中途退出/非在座）。
   * 设计约束：
   * - 中途退出（queued leave）或非在座（含观战）不推送离线事件。
   * - 多终端 / 重连重叠：仅当该用户在本房已无其它 /game 连接时才标记离线并广播。
   * - 离线事件仅服务于当局 seat 托管和 UI 呈现，避免语义污染。
   */
  #handleGameRoomDisconnect(
    channel: string,
    userId: number,
    droppedSocketId: string
  ) {
    const texas = gameRuntimeRegistry.getTexas(channel)
    if (!texas) return
    const isQueuedLeave = gameRuntimeRegistry.hasQueuedLeave(channel, userId)
    const isOnSeat = texas.room.getPlayerSeatStatusById(userId) === 'on-set'
    if (isQueuedLeave || !isOnSeat) {
      gameRuntimeRegistry.clearConnectionTracking(channel, userId)
      void this.#roomCleanupManager.tryCleanupRoomIfAllOffline(channel)
      return
    }
    if (this.#countPeerGameSockets(channel, userId, droppedSocketId) > 0) {
      void this.#roomCleanupManager.tryCleanupRoomIfAllOffline(channel)
      return
    }
    const wasOffline = gameRuntimeRegistry.isUserOffline(channel, userId)
    gameRuntimeRegistry.markUserOffline(channel, userId)
    if (!wasOffline) {
      this.broadcastGameRoom(
        channel,
        {
          type: 'player-status-change',
          data: { roomId: Number(channel), userId, status: 'offline' as const }
        },
        { skipReplay: true }
      )
    }

    void this.#roomCleanupManager.tryCleanupRoomIfAllOffline(channel)
  }

  /**
   * @description 向 /game 房间内所有端广播
   * @param options.skipReplay 为 true 时仅 emit、不写入全房 replay 环形缓冲（与私牌单播同理；如内置语音）。
   */
  #withGameRoomSeqMeta(
    data: Parameters<Socket['send']>[0],
    seq: number
  ): Parameters<Socket['send']>[0] {
    if (
      !data ||
      typeof data !== 'object' ||
      !('type' in data) ||
      typeof (data as { type?: unknown }).type !== 'string'
    ) {
      return data
    }
    return {
      ...(data as Record<string, unknown>),
      seq,
      replayEpoch: getGameRoomReplayEpoch()
    }
  }

  broadcastGameRoom(
    roomId: string,
    data: Parameters<Socket['send']>[0],
    options?: { skipReplay?: boolean }
  ) {
    // TODO: 日志 payload 脱敏（与 broadcastGameToUser 一致）：game-end 的 settleList[].handPokes / pokesToReveal / bestPokes，game-stage-changed 的 pokesToReveal 等
    logger.info(
      `broadcastGameRoom, ${this.#getUserIdsInGameRoom(
        roomId
      )}, data: ${JSON.stringify(data)}`
    )
    if (options?.skipReplay) {
      this.#gameNs.to(roomId).emit('message', data)
      return
    }
    const seq = recordGameRoomBroadcast(roomId, data)
    const payload = this.#withGameRoomSeqMeta(data, seq)
    this.#gameNs.to(roomId).emit('message', payload)
  }

  /**
   * @description 向 /game 房间广播，但排除指定 userId（用于离场类事件避免推给已退出本人）。
   */
  broadcastGameRoomExcept(
    roomId: string,
    excludedUserId: number,
    data: Parameters<Socket['send']>[0]
  ) {
    const visibleUserIds = this.#getUserIdsInGameRoom(roomId).filter(
      (uid) => uid !== excludedUserId
    )
    logger.info(
      `broadcastGameRoomExcept, ${visibleUserIds}, excluded=${excludedUserId}, data: ${JSON.stringify(
        data
      )}`
    )
    const seq = recordGameRoomBroadcast(roomId, data)
    const payload = this.#withGameRoomSeqMeta(data, seq)
    for (const socket of this.#getSocketsInGameRoom(roomId)) {
      const uid = socket.data.userId as number | undefined
      if (uid === excludedUserId) continue
      this.#gameNs.to(socket.id).emit('message', payload)
    }
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

  /** 仅断开该用户在指定房间下的 `/game` 连接（不碰 waiting-room） */
  disconnectUserGameSockets(roomId: number, userId: number) {
    const roomKey = String(roomId)
    const gameTargets = this.#getSocketsInGameRoom(roomKey).filter(
      (s) => (s.data.userId as number) === userId
    )
    if (gameTargets.length === 0) return

    logger.info(
      `[game-socket-disconnect] roomId=${roomId}, userId=${userId}, sockets=${gameTargets.length}`
    )
    gameTargets.forEach((socket) => socket.disconnect(true))
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

    const connectedUserIds = Array.from(
      this.getWaitingRoomOnlineUserIds(tracker.roomIdNumber)
    ).filter((id) => tracker.expected.has(id))
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

  #notifyWaitingRoomEnteringWaiters(roomKey: string) {
    this.#waitingRoomEnteringWaiters.notifyConnected(
      roomKey,
      Array.from(this.getWaitingRoomOnlineUserIds(Number(roomKey)))
    )
  }

  getConnectedGameRoomUserIds(roomId: string): number[] {
    return this.#getUserIdsInGameRoom(roomId)
  }

  /**
   * 等待指定 userId 列表全部建立 /game namespace 连接（非 entering 流程；entering 用 {@link waitForWaitingRoomUsersConnected}）。
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

  /**
   * 等待指定用户均在 `/waiting-room` 该房在线（entering 阶段；对局 `/game` 在客户端进桌后再建）。
   */
  waitForWaitingRoomUsersConnected(
    roomId: string,
    userIds: number[],
    options?: { timeoutMs?: number }
  ): Promise<void> {
    const timeoutMs =
      options?.timeoutMs ?? WAIT_FOR_GAME_USERS_CONNECTED_TIMEOUT_MS
    return this.#waitingRoomEnteringWaiters.waitForConnected(
      roomId,
      userIds,
      () => Array.from(this.getWaitingRoomOnlineUserIds(Number(roomId))),
      timeoutMs
    )
  }
}

export default SocketServer
