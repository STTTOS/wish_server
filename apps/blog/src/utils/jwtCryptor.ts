import jwt from 'jsonwebtoken'

import { tokenValidatedTime } from '../config'

const { SECRET_KEY } = process.env
export function decrypt<T = { id: number }>(
  token: string,
  options?: jwt.VerifyOptions
) {
  const data = jwt.verify(token, SECRET_KEY!, options) as T
  return data
}

export function encrypt(payload: Record<string, unknown>, longTerm = false) {
  const options = longTerm ? {} : { expiresIn: tokenValidatedTime }
  const token = jwt.sign(payload, SECRET_KEY!, options)
  return token
}
