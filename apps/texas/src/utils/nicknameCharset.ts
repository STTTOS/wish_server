/**
 * 昵称可见字符白名单（后端强校验）：
 * - CJK 表意文字：`Script=Hani`
 * - 拉丁系字母（含 é、ñ 等）：`Script=Latin`
 * - **可打印 ASCII** U+0021～U+007E（不含空格 U+0020、控制字符与 DEL）
 *
 * Emoji、零宽字符、假名等仍排除。入库前见 {@link canonicalizeNicknameInput}（**trim + NFKC**）。
 * texasPokerRN 侧字段校验仅 NFKC、不 trim，首尾空格由本函数在服务端统一去掉。
 */

/**
 * trim + NFKC，用于校验与入库（全角字母数字、部分兼容字符会折叠为半角常见形态）。
 */
export function canonicalizeNicknameInput(value: string): string {
  return value.trim().normalize('NFKC')
}

/**
 * 允许：`Script=Hani`、`Script=Latin`、可打印 ASCII `\x21-\x7E`（不含空格与控制符）。
 */
const NICKNAME_ALLOWED_CHARS = /^[\p{Script=Hani}\p{Script=Latin}\x21-\x7E]+$/u

export function isNicknameCharsetAllowed(value: string): boolean {
  if (!value) return false
  return NICKNAME_ALLOWED_CHARS.test(value)
}

/** 非空昵称：若含不允许字符则返回统一错误文案 */
export function getNicknameCharsetError(value: string): string | null {
  if (!value) return null
  if (!isNicknameCharsetAllowed(value)) {
    return '昵称中含特殊字符，请修改'
  }
  return null
}
