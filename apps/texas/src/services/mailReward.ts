import dayjs from 'dayjs'
import { Prisma, type RankCategory } from '@prisma/texas-client'

import prisma from '../models'
import { logger } from '../logger'

const ACHIEVEMENT_MAIL_EXPIRE_DAYS = 30
const COMPENSATION_JOB_INTERVAL_MS = 24 * 60 * 60 * 1000

const POKER_BACK_ITEM_CODE_PREFIX = 'poker_back:'
const MAIL_BIZ_TYPE_ACHIEVEMENT = 'achievement_unlock'
const LEDGER_REASON_MAIL_CLAIM = 'mail_claim'

type AchievementTierKey = 'quads' | 'straight_flush' | 'royal_flush'

type AchievementRule = {
  tier: AchievementTierKey
  pokerBackgroundKey: string
  itemCode: string
  itemName: string
  title: string
  summary: string
  body: string
}

const ACHIEVEMENT_RULES: Record<AchievementTierKey, AchievementRule> = {
  quads: {
    tier: 'quads',
    pokerBackgroundKey: 'card_back_quads_four_kind_reward',
    itemCode: 'poker_back:card_back_quads_four_kind_reward',
    itemName: '四喜冠冕',
    title: '成就奖励',
    summary: '解锁牌型「四条」奖励',
    body: '恭喜你在对局中解锁牌型「四条」，现奖励专属卡面「四喜冠冕」。请点击领取后前往藏品使用。'
  },
  straight_flush: {
    tier: 'straight_flush',
    pokerBackgroundKey: 'card_back_straight_flush_reward',
    itemCode: 'poker_back:card_back_straight_flush_reward',
    itemName: '花顺天脊',
    title: '成就奖励',
    summary: '解锁牌型「同花顺」奖励',
    body: '恭喜你在对局中解锁牌型「同花顺」，现奖励专属卡面「花顺天脊」。请点击领取后前往藏品使用。'
  },
  royal_flush: {
    tier: 'royal_flush',
    pokerBackgroundKey: 'card_back_royal_flush_reward',
    itemCode: 'poker_back:card_back_royal_flush_reward',
    itemName: '九冕同辉',
    title: '成就奖励',
    summary: '解锁牌型「皇家同花顺」奖励',
    body: '恭喜你在对局中解锁牌型「皇家同花顺」，现奖励专属卡面「九冕同辉」。请点击领取后前往藏品使用。'
  }
}

const TIER_ORDER: readonly AchievementTierKey[] = [
  'quads',
  'straight_flush',
  'royal_flush'
]

const RANK_TO_TIER: Partial<Record<RankCategory, AchievementTierKey>> = {
  x: 'quads',
  y: 'straight_flush',
  z: 'royal_flush'
}

type DbLike = Prisma.TransactionClient | typeof prisma

function codeToPokerBackgroundKey(itemCode: string): string | null {
  if (!itemCode.startsWith(POKER_BACK_ITEM_CODE_PREFIX)) return null
  const key = itemCode.slice(POKER_BACK_ITEM_CODE_PREFIX.length).trim()
  return key.length > 0 ? key : null
}

async function upsertAchievementDefinitions(db: DbLike): Promise<void> {
  const rules = Object.values(ACHIEVEMENT_RULES)
  for (const rule of rules) {
    await db.itemDefinition.upsert({
      where: { code: rule.itemCode },
      create: {
        code: rule.itemCode,
        name: rule.itemName,
        description: `卡面奖励：${rule.itemName}`,
        kind: 'entitlement',
        stackable: false,
        config: {
          grant: {
            type: 'poker_back',
            assetKey: rule.pokerBackgroundKey
          }
        },
        sortOrder: 1000,
        isActive: true
      },
      update: {
        kind: 'entitlement',
        isActive: true,
        config: {
          grant: {
            type: 'poker_back',
            assetKey: rule.pokerBackgroundKey
          }
        }
      }
    })
  }
}

async function hasEntitlementByItemCode(
  db: DbLike,
  userId: number,
  itemCode: string
): Promise<boolean> {
  const item = await db.itemDefinition.findUnique({
    where: { code: itemCode },
    select: { id: true }
  })
  if (!item) return false
  const bal = await db.userItemBalance.findUnique({
    where: { userId_itemId: { userId, itemId: item.id } },
    select: { quantity: true }
  })
  return (bal?.quantity ?? 0) > 0
}

export async function listOwnedPokerBackgroundKeys(
  db: DbLike,
  userId: number
): Promise<string[]> {
  const rows = await db.userItemBalance.findMany({
    where: {
      userId,
      quantity: { gt: 0 },
      item: {
        kind: 'entitlement',
        code: { startsWith: POKER_BACK_ITEM_CODE_PREFIX }
      }
    },
    select: {
      item: {
        select: {
          code: true
        }
      }
    }
  })
  const uniq = new Set<string>()
  for (const row of rows) {
    const key = codeToPokerBackgroundKey(row.item.code)
    if (key) uniq.add(key)
  }
  return Array.from(uniq)
}

export async function canUsePokerBackgroundKey(
  db: DbLike,
  userId: number,
  pokerBackgroundKey: string
): Promise<boolean> {
  const itemCode = `${POKER_BACK_ITEM_CODE_PREFIX}${pokerBackgroundKey}`
  const def = await db.itemDefinition.findUnique({
    where: { code: itemCode },
    select: { id: true, kind: true, isActive: true }
  })
  // 没有配置 entitlement 目录项时视为默认免费卡面
  if (!def) return true
  if (def.kind !== 'entitlement' || !def.isActive) return true
  const bal = await db.userItemBalance.findUnique({
    where: { userId_itemId: { userId, itemId: def.id } },
    select: { quantity: true }
  })
  return (bal?.quantity ?? 0) > 0
}

async function createAchievementMailIfNeeded(
  db: DbLike,
  userId: number,
  rule: AchievementRule
): Promise<void> {
  const alreadyOwned = await hasEntitlementByItemCode(db, userId, rule.itemCode)
  if (alreadyOwned) return
  const bizRefId = `${rule.tier}:${rule.pokerBackgroundKey}`
  try {
    await db.userMail.create({
      data: {
        userId,
        title: rule.title,
        summary: rule.summary,
        body: rule.body,
        status: 'unclaimed',
        bizType: MAIL_BIZ_TYPE_ACHIEVEMENT,
        bizRefId,
        claimableAt: new Date(),
        expireAt: dayjs().add(ACHIEVEMENT_MAIL_EXPIRE_DAYS, 'day').toDate(),
        attachments: {
          create: {
            itemCode: rule.itemCode,
            quantity: 1,
            assetType: 'poker_back',
            assetKey: rule.pokerBackgroundKey
          }
        }
      }
    })
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      // 已发过同类奖励邮件（幂等）
      return
    }
    throw error
  }
}

export async function ensureAchievementMailsByRank(
  db: DbLike,
  userId: number,
  rankCategory: RankCategory | null | undefined,
  isFold: boolean
): Promise<void> {
  if (isFold) return
  if (!rankCategory) return
  const tier = RANK_TO_TIER[rankCategory]
  if (!tier) return
  await upsertAchievementDefinitions(db)
  await createAchievementMailIfNeeded(db, userId, ACHIEVEMENT_RULES[tier])
}

export async function runAchievementMailCompensationOnce(): Promise<void> {
  const rows = await prisma.playerMatchRecord.findMany({
    where: {
      isFold: false,
      rankCategory: { in: ['x', 'y', 'z'] }
    },
    select: {
      userId: true,
      rankCategory: true
    }
  })
  if (rows.length === 0) return
  const byUser = new Map<number, Array<{ rankCategory: RankCategory }>>()
  for (const row of rows) {
    const rank = row.rankCategory
    if (!rank) continue
    if (!byUser.has(row.userId)) byUser.set(row.userId, [])
    byUser.get(row.userId)!.push({ rankCategory: rank })
  }
  let processed = 0
  for (const [userId, rks] of byUser.entries()) {
    const tiers = new Set<AchievementTierKey>()
    for (const row of rks) {
      const tier = RANK_TO_TIER[row.rankCategory]
      if (tier) tiers.add(tier)
    }
    if (tiers.size === 0) continue
    await prisma.$transaction(async (tx) => {
      await upsertAchievementDefinitions(tx)
      for (const tier of TIER_ORDER) {
        if (!tiers.has(tier)) continue
        await createAchievementMailIfNeeded(tx, userId, ACHIEVEMENT_RULES[tier])
      }
    })
    processed += 1
  }
  logger.info(`[achievement-compensation] processed users=${processed}`)
}

let compensationRunning = false

export function startAchievementMailCompensationJob(): void {
  const run = async () => {
    if (compensationRunning) return
    compensationRunning = true
    try {
      await runAchievementMailCompensationOnce()
    } catch (error) {
      logger.error('[achievement-compensation] failed', error)
    } finally {
      compensationRunning = false
    }
  }
  void run()
  setInterval(() => {
    void run()
  }, COMPENSATION_JOB_INTERVAL_MS)
}

export async function grantMailAttachments(
  tx: Prisma.TransactionClient,
  userId: number,
  mailId: number
): Promise<void> {
  const attachments = await tx.userMailAttachment.findMany({
    where: { mailId },
    select: { id: true, itemCode: true, quantity: true }
  })
  if (attachments.length === 0) return
  const defs = await tx.itemDefinition.findMany({
    where: { code: { in: attachments.map((a) => a.itemCode) }, isActive: true },
    select: { id: true, code: true }
  })
  const defByCode = new Map(defs.map((d) => [d.code, d] as const))
  for (const a of attachments) {
    const def = defByCode.get(a.itemCode)
    if (!def) {
      throw new Error(`MAIL_ATTACHMENT_ITEM_NOT_FOUND:${a.itemCode}`)
    }
    const quantity = Math.max(1, Math.floor(a.quantity || 1))
    const balance = await tx.userItemBalance.upsert({
      where: {
        userId_itemId: {
          userId,
          itemId: def.id
        }
      },
      create: {
        userId,
        itemId: def.id,
        quantity
      },
      update: {
        quantity: { increment: quantity }
      },
      select: { quantity: true }
    })
    await tx.userItemLedger.create({
      data: {
        userId,
        itemId: def.id,
        delta: quantity,
        balanceAfter: balance.quantity,
        reason: LEDGER_REASON_MAIL_CLAIM,
        refType: 'mail_claim',
        refId: `${mailId}:${a.id}`
      }
    })
  }
}
