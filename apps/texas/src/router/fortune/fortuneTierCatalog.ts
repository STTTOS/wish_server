import type { FortuneTierKey } from '@prisma/texas-client'

/**
 * 档位 → 展示名与签文（不入 `user_daily_fortune` 行，仅 `tierKey` 入库）。
 * 后续若改为表驱动，可在此替换为 DB 查询，接口形状不变。
 */
export type FortunePresentation = {
  tierLabel: string
  copyLines: readonly [string, string]
}

const CATALOG: Record<FortuneTierKey, FortunePresentation> = {
  daJi: {
    tierLabel: '大吉',
    copyLines: ['吉星高照，心随所愿。', '今日宜开心打牌，忌较真。']
  },
  shangJi: {
    tierLabel: '上吉',
    copyLines: ['顺水行舟，小有惊喜。', '宜主动一点，忌拖泥带水。']
  },
  zhongJi: {
    tierLabel: '中吉',
    copyLines: ['平稳有进，细水长流。', '宜守中带攻，忌冒进。']
  },
  xiaoJi: {
    tierLabel: '小吉',
    copyLines: ['微光在前，耐心可见。', '宜小步试探，忌贪大求全。']
  },
  ping: {
    tierLabel: '平',
    copyLines: ['无风无浪，正是修行。', '宜平常心，忌患得患失。']
  }
}

export function presentationForTierKey(
  tierKey: FortuneTierKey
): FortunePresentation {
  return CATALOG[tierKey]
}
