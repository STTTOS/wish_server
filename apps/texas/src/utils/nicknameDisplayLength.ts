/**
 * 与 texasPokerRN `utils/nickname.ts` 一致：展示长度（CJK 计 2），用于服务端校验。
 */
export const NICKNAME_DISPLAY_LENGTH_MIN = 2
export const NICKNAME_DISPLAY_LENGTH_MAX = 16

const CJK_CHAR_RE = /[\u3400-\u9FFF]/

export function getNicknameDisplayLength(value: string): number {
  return Array.from(value).reduce(
    (sum, ch) => sum + (CJK_CHAR_RE.test(ch) ? 2 : 1),
    0
  )
}

export function isNicknameDisplayLengthValid(value: string): boolean {
  const len = getNicknameDisplayLength(value)
  return (
    len >= NICKNAME_DISPLAY_LENGTH_MIN && len <= NICKNAME_DISPLAY_LENGTH_MAX
  )
}

/** 非空昵称的长度错误文案（与 App `getNicknameFieldError` 一致） */
export function getNicknameDisplayLengthError(value: string): string | null {
  const len = getNicknameDisplayLength(value)
  if (len === 0) return null
  if (len < NICKNAME_DISPLAY_LENGTH_MIN) return '昵称太短'
  if (len > NICKNAME_DISPLAY_LENGTH_MAX) return '昵称长度超过限制'
  return null
}
