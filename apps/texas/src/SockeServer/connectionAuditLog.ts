import { logger } from '../logger'
import { clientConnectionEvent } from '../models'

/**
 * `/game` 连接生命周期：写结构化日志 + 落同一张 `client_connection_event`（source=server），
 * 便于与 App 上报事件按 userId/roomId/时间对齐分析。
 */
export type GameConnectionAuditPayload = Readonly<{
  phase: 'connect' | 'disconnect' | 'replay'
  userId: number
  roomId: number
  socketId?: string
  reason?: string
  sinceSeq?: number
  latestSeq?: number
  throughSeq?: number
  eventCount?: number
  truncated?: boolean
  epochMismatch?: boolean
}>

function kindForPhase(phase: GameConnectionAuditPayload['phase']): string {
  if (phase === 'connect') return 'server_socket_connect'
  if (phase === 'disconnect') return 'server_socket_disconnect'
  return 'server_game_room_replay'
}

export function logGameConnectionAudit(
  payload: GameConnectionAuditPayload
): void {
  logger.info(`[conn-audit] ${JSON.stringify(payload)}`)
  void persistServerConnectionEvent(payload).catch((err) => {
    logger.warn('[conn-audit] persist failed', err)
  })
}

async function persistServerConnectionEvent(
  payload: GameConnectionAuditPayload
): Promise<void> {
  const ts = Date.now()
  const clientEventId = [
    'srv',
    payload.phase,
    payload.socketId ?? 'na',
    String(ts)
  ]
    .join('_')
    .slice(0, 48)
  const clientSessionId = `srv_u${payload.userId}_r${payload.roomId}`.slice(
    0,
    48
  )
  await clientConnectionEvent.create({
    data: {
      userId: payload.userId,
      source: 'server',
      clientEventId,
      clientSessionId,
      clientTs: new Date(ts),
      kind: kindForPhase(payload.phase),
      ns: '/game',
      roomId: payload.roomId,
      reason: payload.reason?.slice(0, 120),
      sinceSeq: payload.sinceSeq,
      latestSeq: payload.latestSeq,
      throughSeq: payload.throughSeq,
      eventCount: payload.eventCount,
      truncated: payload.truncated,
      extra: {
        socketId: payload.socketId ?? null,
        epochMismatch: payload.epochMismatch ?? null,
        phase: payload.phase
      }
    }
  })
}
