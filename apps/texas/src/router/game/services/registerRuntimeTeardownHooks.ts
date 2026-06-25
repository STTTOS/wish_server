import { onRuntimeDestroy } from './runtimeRegistry'
import { clearBuiltInVoiceRoomState } from './builtInVoiceBroadcastScheduler'
import { clearPlayerTurnTimeout } from './texasDomain/playerTurnTimeoutScheduler'
import {
  cancelNextHandCountdown,
  unregisterNextHandHooks
} from '../../../gameRuntime/nextHandCountdown'

type RuntimeTeardownDeps = {
  purgeRoomLocalState: (roomKey: string) => void
}

/**
 * 注册进程级 runtime 销毁钩子（须在 SocketServer 初始化后调用）。
 * 与 `runtimeRegistry` 解耦，避免与 `nextHandCountdown` / 超时调度器的循环 import。
 */
export function registerRuntimeTeardownHooks(deps: RuntimeTeardownDeps): void {
  onRuntimeDestroy((roomKey, roomId) => {
    if (Number.isFinite(roomId) && roomId > 0) {
      try {
        cancelNextHandCountdown(roomId)
        unregisterNextHandHooks(roomId)
      } catch {
        // ignore teardown races
      }
      clearBuiltInVoiceRoomState(roomId)
    }
    clearPlayerTurnTimeout(roomKey)
    deps.purgeRoomLocalState(roomKey)
  })
}
