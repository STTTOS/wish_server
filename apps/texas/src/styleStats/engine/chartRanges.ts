import type { Role } from '@prisma/texas-client'

const RANK_ORDER = '23456789tjqka'

const rankIndex = (r: string) => RANK_ORDER.indexOf(r.toLowerCase())

/** 将两张底牌规范为 AKs / AKo / 22 */
export const normalizeHoleLabel = (pokes: string[]): string | null => {
  if (pokes.length !== 2) return null
  const a = pokes[0]
  const b = pokes[1]
  if (!a || !b || a.length < 2 || b.length < 2) return null
  const r0 = a.slice(1).toLowerCase()
  const r1 = b.slice(1).toLowerCase()
  const s0 = a[0]
  const s1 = b[0]
  if (rankIndex(r0) < 0 || rankIndex(r1) < 0) return null
  if (r0 === r1) return `${r0}${r1}`
  const high = rankIndex(r0) >= rankIndex(r1) ? r0 : r1
  const low = rankIndex(r0) >= rankIndex(r1) ? r1 : r0
  const suited = s0 === s1
  return `${high.toUpperCase()}${low.toUpperCase()}${suited ? 's' : 'o'}`
}

const PAIRS_22_PLUS = new Set(
  [
    '22',
    '33',
    '44',
    '55',
    '66',
    '77',
    '88',
    '99',
    'tt',
    'jj',
    'qq',
    'kk',
    'aa'
  ].map((x) => x)
)

/** 较宽现金桌参考：晚位开池 / 防守可接受的标签（非 GTO） */
const WIDE_OPEN = new Set<string>([
  ...PAIRS_22_PLUS,
  'AKs',
  'AKo',
  'AQs',
  'AQo',
  'AJs',
  'AJo',
  'ATs',
  'ATo',
  'A9s',
  'A8s',
  'A7s',
  'A6s',
  'A5s',
  'A4s',
  'A3s',
  'A2s',
  'KQs',
  'KQo',
  'KJs',
  'KJo',
  'KTs',
  'KTo',
  'K9s',
  'QJs',
  'QJo',
  'QTs',
  'Q9s',
  'JTs',
  'JTo',
  'J9s',
  'T9s',
  'T8s',
  '98s',
  '97s',
  '87s',
  '76s',
  '65s',
  '54s'
])

const TIGHT_OPEN = new Set<string>([
  '77',
  '88',
  '99',
  'tt',
  'jj',
  'qq',
  'kk',
  'aa',
  'AKs',
  'AKo',
  'AQs',
  'AQo',
  'AJs',
  'AJo',
  'ATs',
  'KQs',
  'KQo',
  'KJs',
  'QJs'
])

const MID_OPEN = new Set<string>([
  ...TIGHT_OPEN,
  '22',
  '33',
  '44',
  '55',
  '66',
  'ATo',
  'A9s',
  'A8s',
  'A5s',
  'KTs',
  'KJo',
  'QTs',
  'QJo',
  'JTs',
  'T9s',
  '98s',
  '87s'
])

const chartForRole = (role: Role | null): Set<string> => {
  switch (role) {
    case 'utg':
    case 'utg1':
    case 'utg2':
      return TIGHT_OPEN
    case 'mp':
    case 'lj':
    case 'hj':
      return MID_OPEN
    case 'co':
    case 'btn':
    case 'sb':
    case 'bb':
      return WIDE_OPEN
    default:
      return MID_OPEN
  }
}

/** 入池手是否落在该座位参考表内（私房放宽后的社区表） */
export const isHoleInChart = (pokes: string[], role: Role | null): boolean => {
  const label = normalizeHoleLabel(pokes)
  if (!label) return false
  // pairs stored lowercase in sets
  const key = label.length === 2 ? label.toLowerCase() : label
  const chart = chartForRole(role)
  if (key.length === 2) return chart.has(key) || PAIRS_22_PLUS.has(key)
  return chart.has(key)
}
