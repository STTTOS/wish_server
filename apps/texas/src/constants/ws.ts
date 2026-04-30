/**
 * WebSocket / Socket.IO 相关常量集中管理。
 *
 * pingInterval：多久发一次心跳 ping（过小费电、占流量；德州对局节奏主要靠服务端行动计时，不必秒级心跳）。
 * pingTimeout：发出 ping 后多久未收到 pong 视为断线（移动弱网/切后台需留足余量）。
 * 与座位思考时长无关；略放宽可降低误断连，但会推迟发现真死链。
 */
/** 最坏发现断链约 `pingInterval + pingTimeout`（Engine.IO）；与客户端断网弹窗策略独立 */
export const SOCKET_IO_PING_TIMEOUT_MS = 12_000
export const SOCKET_IO_PING_INTERVAL_MS = 8_000

export const WAIT_FOR_GAME_USERS_CONNECTED_TIMEOUT_MS = 15_000
