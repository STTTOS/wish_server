import jwt from 'jsonwebtoken'

import { tokenValidatedTime } from '../config'

const { SECRET_KEY } = process.env

export type JwtPayload = {
  id: number
}

export function decrypt<T = JwtPayload>(
  token: string,
  options?: jwt.VerifyOptions
) {
  return jwt.verify(token, SECRET_KEY!, options) as T
}

export function encrypt(payload: Record<string, unknown>, longTerm = false) {
  const options = longTerm ? {} : { expiresIn: tokenValidatedTime }
  return jwt.sign(payload, SECRET_KEY!, options)
}
