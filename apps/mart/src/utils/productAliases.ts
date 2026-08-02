const ALIAS_MAX_ITEM_LENGTH = 32
const ALIAS_MAX_STORED_LENGTH = 500

/** DB 逗号串 → API 数组 */
export function parseAliasesStored(value: string | null | undefined): string[] {
  if (!value) return []
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

/** API 数组 → DB 逗号串；空则 null */
export function serializeAliases(aliases: string[]): string | null {
  if (aliases.length === 0) return null
  return aliases.join(',')
}

export type AliasesValidationResult =
  | { ok: true; data: string[] | null | undefined }
  | { ok: false; message: string }

/**
 * 可选别名：
 * - undefined → 未传
 * - null / [] → 清空
 * - string[] / 逗号串 → 规范化去重
 */
export function validateOptionalAliases(
  value: unknown
): AliasesValidationResult {
  if (value === undefined) return { ok: true, data: undefined }
  if (value === null) return { ok: true, data: null }

  let rawItems: string[]
  if (typeof value === 'string') {
    rawItems = value.split(/[,，、]/)
  } else if (Array.isArray(value)) {
    if (!value.every((item) => typeof item === 'string')) {
      return { ok: false, message: '别名参数异常' }
    }
    rawItems = value
  } else {
    return { ok: false, message: '别名参数异常' }
  }

  const seen = new Set<string>()
  const aliases: string[] = []
  for (const item of rawItems) {
    const trimmed = item.trim()
    if (!trimmed) continue
    if (trimmed.length > ALIAS_MAX_ITEM_LENGTH) {
      return { ok: false, message: '单个别名过长' }
    }
    if (seen.has(trimmed)) continue
    seen.add(trimmed)
    aliases.push(trimmed)
  }

  if (aliases.length === 0) return { ok: true, data: null }

  const stored = serializeAliases(aliases)
  if (stored && stored.length > ALIAS_MAX_STORED_LENGTH) {
    return { ok: false, message: '别名总长度过长' }
  }

  return { ok: true, data: aliases }
}
