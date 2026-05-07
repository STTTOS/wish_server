import {
  CLIENT_TABLE_BG_IDS,
  CLIENT_POKER_BACK_IDS
} from './clientAssetIds.manifest'

const pokerSet = new Set(CLIENT_POKER_BACK_IDS as readonly string[])
const tableSet = new Set(CLIENT_TABLE_BG_IDS as readonly string[])

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
