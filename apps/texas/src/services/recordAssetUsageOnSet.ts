import type { PrismaClient } from '@prisma/texas-client'

import { AssetUsageType } from '@prisma/texas-client'

/** 与旧版客户端防抖一致：同用户同资源短时间重复设置不计入频次 */
export const ASSET_USAGE_SET_DEBOUNCE_MS = 45_000

export type ShouldRecordAssetUsageOnSetInput = {
  previousAssetId: string
  nextAssetId: string
  /** 该用户对该 assetId 最近一次上报时间；无记录则为 null */
  lastSameAssetEventAt: Date | null
  now?: Date
}

/**
 * 设置卡面/牌桌时是否应追加 asset_usage_event。
 *
 * 去重规则（事件次数口径，非 UV）：
 * 1. 值未变（幂等重复设置）→ 不计
 * 2. 距该用户对该 assetId 的上次记录不足 DEBOUNCE_MS → 不计（防连点 / A→B→A 抖动）
 */
export function shouldRecordAssetUsageOnSet(
  input: ShouldRecordAssetUsageOnSetInput
): boolean {
  if (input.previousAssetId === input.nextAssetId) return false
  if (input.lastSameAssetEventAt == null) return true
  const now = input.now ?? new Date()
  return (
    now.getTime() - input.lastSameAssetEventAt.getTime() >=
    ASSET_USAGE_SET_DEBOUNCE_MS
  )
}

export async function recordAssetUsageOnSet(
  db: PrismaClient,
  params: {
    userId: number
    assetType: AssetUsageType
    assetId: string
    previousAssetId: string
  }
): Promise<void> {
  const assetId = params.assetId.trim()
  const previousAssetId = params.previousAssetId.trim() || 'default'

  const lastRow = await db.assetUsageEvent.findFirst({
    where: {
      userId: params.userId,
      assetType: params.assetType,
      assetId
    },
    orderBy: { serverTs: 'desc' },
    select: { serverTs: true }
  })

  if (
    !shouldRecordAssetUsageOnSet({
      previousAssetId,
      nextAssetId: assetId,
      lastSameAssetEventAt: lastRow?.serverTs ?? null
    })
  ) {
    return
  }

  await db.assetUsageEvent.create({
    data: {
      userId: params.userId,
      assetType: params.assetType,
      assetId,
      platform: null
    }
  })
}
