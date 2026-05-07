import {
  CLIENT_TABLE_BG_IDS,
  CLIENT_POKER_BACK_IDS,
  CLIENT_PROFILE_AVATAR_KEYS,
  CLIENT_BUILT_IN_VOICE_NAMES
} from './clientAssetIds.manifest'

const pokerSet = new Set(CLIENT_POKER_BACK_IDS as readonly string[])
const tableSet = new Set(CLIENT_TABLE_BG_IDS as readonly string[])
const profileAvatarSet = new Set(
  CLIENT_PROFILE_AVATAR_KEYS as readonly string[]
)
const builtInVoiceSet = new Set(
  CLIENT_BUILT_IN_VOICE_NAMES as readonly string[]
)

export type ClientAssetUsageType = 'poker_back' | 'table_bg'

export function isAllowedClientAssetUsage(
  assetType: ClientAssetUsageType,
  assetId: string
): boolean {
  const id = assetId.trim()
  if (!id || id.length > 64) return false
  if (assetType === 'poker_back') return pokerSet.has(id)
  return tableSet.has(id)
}

/** 卡面（与客户端 pokerBackgroundKey、打点 poker_back 同源清单） */
export function isAllowedPokerBackgroundKey(key: string): boolean {
  return isAllowedClientAssetUsage('poker_back', key)
}

/** 预设头像 compoundKey：category/id，与 RN profileAvatars 导出一致 */
export function isAllowedProfileAvatarKey(avatarKey: string): boolean {
  const k = avatarKey.trim()
  if (!k || k.length > 128) return false
  return profileAvatarSet.has(k)
}

/** 内置语音名，与 RN builtInVoices 导出一致 */
export function isAllowedBuiltInVoiceName(voiceName: string): boolean {
  const n = voiceName.trim()
  if (!n || n.length > 64) return false
  return builtInVoiceSet.has(n)
}
