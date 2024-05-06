import jwt from 'jsonwebtoken'

import { tokenValidatedTime } from '../config'

const { SECRET_KEY } = process.env
export function decrypt(token: string) {
  const user = jwt.verify(token, SECRET_KEY!) as { id: number } | undefined
  return user
}

export function encrypt(payload: Record<string, unknown>) {
  const token = jwt.sign(payload, SECRET_KEY!, {
    expiresIn: tokenValidatedTime
  })
  return token
}
