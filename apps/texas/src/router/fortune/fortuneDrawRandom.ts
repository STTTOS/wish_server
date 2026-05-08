import type { FortuneTierKey } from '@prisma/texas-client'

import { createHash } from 'node:crypto'
import { type Poke, createStandardDeckPokes } from 'texas-poker-core'

/** 与历史权重一致：平×2、小吉×2、中吉×2、上吉、大吉 */
const WEIGHTED_TIER_KEYS: readonly FortuneTierKey[] = [
  'ping',
  'ping',
  'xiaoJi',
  'xiaoJi',
  'zhongJi',
  'zhongJi',
  'shangJi',
  'daJi'
]

function readU32BE(buf: Buffer, byteOffset: number): number {
  return buf.readUInt32BE(byteOffset)
}

/**
 * 由 `userId` + 服务端定局 UTC ISO（与写入请求同一瞬）稳定决定档位键。
 * `fortuneOn` 仅用于「每日一行」唯一约束，不参与此哈希。
 */
export function deterministicFortuneTierKey(
  userId: number,
  instantUtc: string
): FortuneTierKey {
  const digest = createHash('sha256')
    .update(`fortune:tier:${userId}:${instantUtc}`, 'utf8')
    .digest()
  const i = readU32BE(digest, 0) % WEIGHTED_TIER_KEYS.length
  return WEIGHTED_TIER_KEYS[i]!
}

/**
 * 由 `userId` + 服务端定局 UTC ISO 稳定决定幸运牌（与 `createStandardDeckPokes` 顺序一致）。
 */
export function deterministicLuckyPoke(
  userId: number,
  instantUtc: string
): Poke {
  const deck: readonly Poke[] = createStandardDeckPokes()
  const digest = createHash('sha256')
    .update(`fortune:poke:${userId}:${instantUtc}`, 'utf8')
    .digest()
  const i = readU32BE(digest, 0) % deck.length
  const poke: Poke = deck[i]!
  return poke
}
