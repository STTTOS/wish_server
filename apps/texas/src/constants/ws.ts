/**
 * WebSocket / Socket.IO 相关常量集中管理。
 *
 * pingInterval：多久发一次心跳 ping（过小费电、占流量；德州对局节奏主要靠服务端行动计时，不必秒级心跳）。
 * pingTimeout：发出 ping 后多久未收到 pong 视为断线（移动弱网/切后台需留足余量）。
 *
 * 与 socket.io 默认一致，利于与官方 client 协商，且比 3s/8s 更不易误杀仍在线连接。
 */
export const SOCKET_IO_PING_TIMEOUT_MS = 20_000
export const SOCKET_IO_PING_INTERVAL_MS = 25_000

export const WAIT_FOR_GAME_USERS_CONNECTED_TIMEOUT_MS = 15_000
