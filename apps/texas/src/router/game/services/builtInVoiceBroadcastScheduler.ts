import type { GameWsGateway } from './gameWsGateway'

import { logger } from '../../../logger'
import { BUILT_IN_VOICE_ROOM_EMIT_MIN_INTERVAL_MS } from '../builtInVoiceConstants'

const roomLastEmitAt = new Map<number, number>()
const roomEmitChains = new Map<number, Promise<void>>()
const builtInVoiceUserLastAt = new Map<string, number>()

function builtInVoiceUserKey(roomId: number, userId: number): string {
  return `${roomId}:${userId}`
}

export function recordBuiltInVoiceUserEmit(
  roomId: number,
  userId: number
): void {
  builtInVoiceUserLastAt.set(builtInVoiceUserKey(roomId, userId), Date.now())
}

export function getBuiltInVoiceUserLastEmitAt(
  roomId: number,
  userId: number
): number {
  return builtInVoiceUserLastAt.get(builtInVoiceUserKey(roomId, userId)) ?? 0
}

/** 房间 runtime 销毁时释放内置语音队列与冷却记录。 */
export function clearBuiltInVoiceRoomState(roomId: number): void {
  roomLastEmitAt.delete(roomId)
  roomEmitChains.delete(roomId)
  const prefix = `${roomId}:`
  for (const key of builtInVoiceUserLastAt.keys()) {
    if (key.startsWith(prefix)) builtInVoiceUserLastAt.delete(key)
  }
}

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
