import { SHA256 } from 'crypto-js'

/** 与 blog 重置密码一致：SHA256 十六进制摘要 */
export function hashPassword(plain: string) {
  return SHA256(plain).toString()
}

export function verifyPassword(plain: string, hashed: string) {
  return hashPassword(plain) === hashed
}
