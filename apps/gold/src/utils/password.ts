import { randomBytes, scryptSync, timingSafeEqual } from 'crypto'

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, 64).toString('hex')
  return `scrypt:${salt}:${hash}`
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split(':')
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false
  const salt = parts[1]
  const expected = parts[2]
  if (!salt || !expected) return false
  const got = scryptSync(password, salt, 64).toString('hex')
  try {
    return timingSafeEqual(
      Buffer.from(got, 'hex'),
      Buffer.from(expected, 'hex')
    )
  } catch {
    return false
  }
}
