/** 客户端可选的内置语音 key，须与白名单一致 */
export const BUILT_IN_VOICE_NAMES = [
  'i_want_to_check_pokes',
  'shin_my_shoes_for_me',
  'ma_le',
  'urge_someone_to_reveal_their_hand',
  'there_is_nothing_wrong_with_the_cards',
  'dasima_am_i_strong',
  'dasima_heihei',
  'dasima_what_r_u_doing',
  'dasima_how_do_you_do'
] as const

export type BuiltInVoiceName = (typeof BUILT_IN_VOICE_NAMES)[number]

export const BUILT_IN_VOICE_NAME_SET = new Set<string>(BUILT_IN_VOICE_NAMES)

/** 同一房间内，相邻两次内置语音 WS 广播的最小间隔（毫秒） */
export const BUILT_IN_VOICE_ROOM_EMIT_MIN_INTERVAL_MS = 3000

/** 同一玩家在同一房间内，两次发送请求的最小间隔（毫秒） */
export const BUILT_IN_VOICE_USER_COOLDOWN_MS = 5000
