import type { GameWsGateway } from './gameWsGateway'

import { logger } from '../../../logger'
import { BUILT_IN_VOICE_ROOM_EMIT_MIN_INTERVAL_MS } from '../../../constants/builtInVoice'

const roomLastEmitAt = new Map<number, number>()
const roomEmitChains = new Map<number, Promise<void>>()

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * 将一次内置语音广播排入该房间的队列：保证同一房间任意两次实际发出至少间隔
 * `BUILT_IN_VOICE_ROOM_EMIT_MIN_INTERVAL_MS`。
 */
export function scheduleBuiltInVoiceBroadcast(
  roomId: number,
  payload: { userId: number; voiceName: string },
  gateway: GameWsGateway
): void {
  const prev = roomEmitChains.get(roomId) ?? Promise.resolve()
  const next = prev
    .then(async () => {
      const last = roomLastEmitAt.get(roomId) ?? 0
      const wait = Math.max(
        0,
        BUILT_IN_VOICE_ROOM_EMIT_MIN_INTERVAL_MS - (Date.now() - last)
      )
      if (wait > 0) {
        await sleep(wait)
      }
      gateway.notifyPlayerBuiltInVoice(String(roomId), payload)
      roomLastEmitAt.set(roomId, Date.now())
    })
    .catch((err: unknown) => {
      logger.error(
        '[built-in-voice] scheduled broadcast failed',
        err instanceof Error ? err : String(err)
      )
    })
  roomEmitChains.set(roomId, next)
}
