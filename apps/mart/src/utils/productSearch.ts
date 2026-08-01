/**
 * 商品名称宽松匹配：将关键词拆成字符序列，生成 LIKE 模式。
 * 例：「香甜蛋挞」→ `%香%甜%蛋%挞%`，可命中「香甜滋味手工蛋挞」。
 */
export function buildNameSubsequenceLikePattern(keyword: string): string {
  const compact = keyword.trim().replace(/\s+/g, '')
  if (!compact) return '%'

  const parts = [...compact].map((ch) =>
    ch.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')
  )
  return `%${parts.join('%')}%`
}

/** 供单测 / 本地校验：名称是否按序包含关键词各字符 */
export function matchNameBySubsequence(name: string, keyword: string): boolean {
  const compact = keyword.trim().replace(/\s+/g, '')
  if (!compact) return true

  let from = 0
  for (const ch of compact) {
    const idx = name.indexOf(ch, from)
    if (idx === -1) return false
    from = idx + 1
  }
  return true
}
