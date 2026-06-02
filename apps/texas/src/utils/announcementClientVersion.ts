import { compareSemverCore, isValidSemverCoreString } from './semverCompare'

export type AnnouncementClientVersionRange = {
  minClientVersion: string | null
  maxClientVersion: string | null
}

type ParseVersionFieldResult =
  | { ok: true; value: string | null }
  | { ok: false; error: string }

export function parseOptionalClientVersionField(
  value: unknown,
  fieldName: string
): ParseVersionFieldResult {
  if (value === undefined || value === null || value === '') {
    return { ok: true, value: null }
  }
  const trimmed = String(value).trim()
  if (!trimmed) {
    return { ok: true, value: null }
  }
  if (!isValidSemverCoreString(trimmed)) {
    return {
      ok: false,
      error: `${fieldName} 须为 semver 主版本号，如 1.0.0`
    }
  }
  return { ok: true, value: trimmed }
}

export function parseAnnouncementClientVersionRange(
  minRaw: unknown,
  maxRaw: unknown
):
  | { ok: true; range: AnnouncementClientVersionRange }
  | { ok: false; error: string } {
  const minParsed = parseOptionalClientVersionField(minRaw, 'minClientVersion')
  if (!minParsed.ok) return minParsed

  const maxParsed = parseOptionalClientVersionField(maxRaw, 'maxClientVersion')
  if (!maxParsed.ok) return maxParsed

  const range: AnnouncementClientVersionRange = {
    minClientVersion: minParsed.value,
    maxClientVersion: maxParsed.value
  }

  const rangeErr = validateAnnouncementClientVersionRange(range)
  if (rangeErr) {
    return { ok: false, error: rangeErr }
  }

  return { ok: true, range }
}

export function validateAnnouncementClientVersionRange(
  range: AnnouncementClientVersionRange
): string | null {
  const { minClientVersion, maxClientVersion } = range
  if (minClientVersion != null && maxClientVersion != null) {
    const cmp = compareSemverCore(minClientVersion, maxClientVersion)
    if (cmp == null) return '版本范围格式异常'
    if (cmp > 0) return '最低版本不能高于最高版本'
  }
  return null
}

/** 闭区间 [min, max]；二者均为 null 表示全部版本 */
export function matchesAnnouncementClientVersion(
  range: AnnouncementClientVersionRange,
  clientVersion: string
): boolean {
  const { minClientVersion, maxClientVersion } = range
  if (minClientVersion == null && maxClientVersion == null) return true
  if (!isValidSemverCoreString(clientVersion)) return false

  if (
    minClientVersion != null &&
    (compareSemverCore(clientVersion, minClientVersion) ?? -1) < 0
  ) {
    return false
  }
  if (
    maxClientVersion != null &&
    (compareSemverCore(clientVersion, maxClientVersion) ?? 1) > 0
  ) {
    return false
  }
  return true
}

export function formatAnnouncementClientVersionRange(
  range: AnnouncementClientVersionRange
): string {
  const { minClientVersion, maxClientVersion } = range
  if (minClientVersion == null && maxClientVersion == null) return '全部版本'
  if (minClientVersion != null && maxClientVersion != null) {
    if (minClientVersion === maxClientVersion) return minClientVersion
    return `${minClientVersion} ~ ${maxClientVersion}`
  }
  if (minClientVersion != null) return `≥ ${minClientVersion}`
  return `≤ ${maxClientVersion}`
}
