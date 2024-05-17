import jwt from 'jsonwebtoken'

import { tokenValidatedTime } from '../config'

const { SECRET_KEY } = process.env
export function decrypt<T = { id: number }>(token: string) {
  const user = jwt.verify(token, SECRET_KEY!) as T
  return user
}

export function encrypt(payload: Record<string, unknown>, longTerm = false) {
  const token = jwt.sign(payload, SECRET_KEY!, {
    expiresIn: longTerm ? undefined : tokenValidatedTime
  })
  return token
}
