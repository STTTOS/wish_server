import { CLIENT_BUILT_IN_VOICE_NAMES } from '../../constants/clientAssetIds.manifest'

/** 与 RN `constants/builtInVoices` 经 export-client-asset-ids 生成的清单一致 */
export const BUILT_IN_VOICE_NAMES = CLIENT_BUILT_IN_VOICE_NAMES

export type BuiltInVoiceName = (typeof BUILT_IN_VOICE_NAMES)[number]

/** 同一房间内，相邻两次内置语音 WS 广播的最小间隔（毫秒） */
export const BUILT_IN_VOICE_ROOM_EMIT_MIN_INTERVAL_MS = 3000

/** 同一玩家在同一房间内，两次发送请求的最小间隔（毫秒） */
export const BUILT_IN_VOICE_USER_COOLDOWN_MS = 5000
