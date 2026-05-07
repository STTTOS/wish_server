/**
 * 轻量 semver 主版本号比较（x.y.z 数值段），用于 App 最低版本校验。
 * 忽略先行版/元数据后缀（如 1.0.0-beta 按 1.0.0 比）。
 */
export function parseSemverCore(
  input: string
): { major: number; minor: number; patch: number } | null {
  const s = input.trim()
  if (!s) return null
  const core = s.split('-')[0].split('+')[0]
  const parts = core.split('.')
  const major = Number(parts[0])
  const minor = parts.length > 1 ? Number(parts[1]) : 0
  const patch = parts.length > 2 ? Number(parts[2]) : 0
  if (![major, minor, patch].every((n) => Number.isFinite(n) && n >= 0)) {
    return null
  }
  return { major, minor, patch }
}

/** <0: a<b, 0: 相等, >0: a>b */
export function compareSemverCore(a: string, b: string): number | null {
  const pa = parseSemverCore(a)
  const pb = parseSemverCore(b)
  if (!pa || !pb) return null
  if (pa.major !== pb.major) return pa.major - pb.major
  if (pa.minor !== pb.minor) return pa.minor - pb.minor
  return pa.patch - pb.patch
}

export function isValidSemverCoreString(input: string): boolean {
  return parseSemverCore(input) != null
}
